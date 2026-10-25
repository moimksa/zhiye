from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from init_workspace import initialize


class WorkspaceTests(unittest.TestCase):
    def test_initialization_preserves_existing_personal_records(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '模板').mkdir()
            for name in ('学习档案.md', '学习记录.md', '当前重点.md'):
                (root / '模板' / name).write_text('# 空白模板', encoding='utf-8')
            self.assertEqual(len(initialize(root)), 3)
            record = root / '个人资料' / '学习记录.md'
            record.write_text('已有的个人记录', encoding='utf-8')
            self.assertEqual(initialize(root), [])
            self.assertEqual(record.read_text(encoding='utf-8'), '已有的个人记录')
            self.assertTrue((root / '个人资料' / '课程').is_dir())


if __name__ == '__main__':
    unittest.main()
