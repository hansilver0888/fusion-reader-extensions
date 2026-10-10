import hashlib
import tempfile
import unittest
from pathlib import Path
from build_repository import build, ROOT


class RepositoryTests(unittest.TestCase):
    def test_every_catalog_entry_resolves_to_exact_script_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = build(temporary, 'https://example.com/plugins/')
            packages = set()
            for entry in result['extensions']:
                self.assertNotIn(entry['package'], packages)
                packages.add(entry['package'])
                data = (Path(temporary) / entry['url']).read_bytes()
                self.assertEqual(len(data), entry['size'])
                self.assertEqual(hashlib.sha256(data).hexdigest(), entry['sha256'])
                self.assertIn('// @package', data.decode('utf-8'))
                self.assertEqual(entry['minAppVersion'],
                                 '1.4.2' if entry['package'] == 'omofun' else '1.4.0')
            self.assertEqual(packages, {path.stem for path in (ROOT / 'sources').glob('*.js')})


if __name__ == '__main__':
    unittest.main()
