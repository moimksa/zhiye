import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Library, make_handler


class ReaderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / 'workspace'
        self.root.mkdir()
        self.note = self.root / '知识库' / '数学' / 'Example-Course' / '01-示例.md'
        self.note.parent.mkdir(parents=True)
        self.note.write_text('# 第 1 章 向量（vector）\n\n两个向量正交。\n', encoding='utf-8')
        self.relative = self.note.relative_to(self.root).as_posix()
        self.library = Library(self.root, Path(self.temp.name) / 'data')
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(self.library))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = 'http://127.0.0.1:%d' % self.server.server_port

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, route, data=None, method='GET', extra=None):
        headers = {'X-Reader-Request': '1', 'Content-Type': 'application/json', **(extra or {})}
        request = Request(self.base + route, data=json.dumps(data).encode() if data is not None else None, headers=headers, method=method)
        with urlopen(request) as response:
            return json.load(response)

    def test_index_refresh_and_unicode_search(self):
        initial = self.request('/api/index')
        self.assertEqual(initial['documents'][0]['title'], '第 1 章 向量')
        self.assertEqual(initial['documents'][0]['course'], 'Example Course')
        self.assertEqual(initial['documents'][0]['group'], '章节讲义')
        extra = self.note.with_name('02-新增.md')
        extra.write_text('# 新增\n特征值 eigenvalue', encoding='utf-8')
        self.assertEqual(len(self.request('/api/index')['documents']), 2)
        self.assertEqual(len(self.request('/api/search?q=eigenvalue')['results']), 1)
        self.assertNotEqual(initial['fingerprint'], self.request('/api/index')['fingerprint'])

    def test_annotations_survive_reload_without_touching_notes(self):
        original = self.note.read_bytes()
        payload = {'document': self.relative, 'quote': '两个向量正交', 'start': 10, 'end': 16, 'prefix': '前文', 'suffix': '后文', 'color': 'green'}
        created = self.request('/api/highlights', payload, 'POST')
        self.request('/api/highlights/' + created['id'], {'note': '内积等于零。'}, 'PATCH')
        self.request('/api/state', {'position': {'document': self.relative, 'value': .35}, 'preferences': {'theme': 'dark'}, 'lastDocument': self.relative}, 'PATCH')
        new_instance = Library(self.root, self.library.data_dir)
        restored = new_instance.read_state()
        self.assertEqual(restored['highlights'][0]['note'], '内积等于零。')
        self.assertEqual(restored['positions'][self.relative], .35)
        self.assertEqual(restored['preferences']['theme'], 'dark')
        self.assertEqual(original, self.note.read_bytes())
        self.request('/api/highlights/' + created['id'], method='DELETE')
        self.assertEqual(self.request('/api/export')['highlights'], [])

    def test_private_paths_and_foreign_writes_are_rejected(self):
        hidden = self.root / '.private.md'
        hidden.write_text('private')
        outside = Path(self.temp.name) / 'outside.md'
        outside.write_text('outside')
        for name in ['../outside.md', '.private.md']:
            with self.assertRaises(FileNotFoundError):
                self.library.resolve(name)
        with self.assertRaises(HTTPError) as caught:
            self.request('/api/state', {'preferences': {'theme': 'dark'}}, 'PATCH', {'Origin': 'https://another.example'})
        self.assertEqual(caught.exception.code, 403)

    def test_original_pdf_range_serving(self):
        pdf = self.root / 'course.pdf'
        pdf.write_bytes(b'%PDF-1.7\n' + b'A' * 128)
        request = Request(self.base + '/file?path=course.pdf', headers={'Range': 'bytes=0-7'})
        with urlopen(request) as response:
            self.assertEqual(response.status, 206)
            self.assertEqual(response.read(), b'%PDF-1.7')

    def test_local_personal_notes_are_readable_but_reader_state_is_not(self):
        personal = self.root / '个人资料' / '知识库' / '测试课程' / '01-笔记.md'
        personal.parent.mkdir(parents=True)
        personal.write_text('# 测试笔记\n仅用于测试。', encoding='utf-8')
        private = self.root / '阅读器' / 'data' / '阅读记录.json'
        private.parent.mkdir(parents=True)
        private.write_text('{}')
        indexed = self.library.index()['documents']
        entry = next(doc for doc in indexed if doc['path'].startswith('个人资料/'))
        self.assertEqual(entry['group'], '章节讲义')
        self.assertEqual(entry['course'], '测试课程')
        with self.assertRaises(FileNotFoundError):
            self.library.resolve('阅读器/data/阅读记录.json')

    def test_external_hosts_and_escaping_symlinks_are_rejected(self):
        for method, data in [('GET', None), ('PATCH', {'preferences': {'theme': 'dark'}})]:
            with self.assertRaises(HTTPError) as caught:
                self.request('/api/state', data, method, {'Host': 'external.example'})
            self.assertEqual(caught.exception.code, 403)
        outside = Path(self.temp.name) / 'outside.md'
        outside.write_text('outside')
        link = self.root / 'outside-link.md'
        link.symlink_to(outside)
        with self.assertRaises(FileNotFoundError):
            self.library.resolve('outside-link.md')
        self.assertFalse(any(doc['path'] == 'outside-link.md' for doc in self.library.index()['documents']))


if __name__ == '__main__':
    unittest.main()
