import os
import tempfile
import unittest
from pathlib import Path

from credential_env import load_credential_environment, parse_environment_file


class CredentialEnvironmentTests(unittest.TestCase):
    def test_parse_supports_quotes_and_export(self):
        self.assertEqual(
            parse_environment_file('A=plain\nexport B="with space"\n# hidden\n'),
            {"A": "plain", "B": "with space"},
        )

    def test_parse_rejects_commands(self):
        with self.assertRaises(ValueError):
            parse_environment_file("BAD=$(do something)\n")

    def test_load_without_overwriting_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "backend.env").write_text("ONE=credential\nTWO=protected\n")
            (root / "graph-mail.env").write_text("THREE=mail\n")
            previous = {key: os.environ.get(key) for key in ("CREDENTIALS_DIRECTORY", "ONE", "TWO", "THREE")}
            try:
                os.environ["CREDENTIALS_DIRECTORY"] = directory
                os.environ["ONE"] = "explicit"
                os.environ.pop("TWO", None)
                os.environ.pop("THREE", None)
                self.assertEqual(load_credential_environment(), 2)
                self.assertEqual(os.environ["ONE"], "explicit")
                self.assertEqual(os.environ["TWO"], "protected")
                self.assertEqual(os.environ["THREE"], "mail")
            finally:
                for key, value in previous.items():
                    if value is None:
                        os.environ.pop(key, None)
                    else:
                        os.environ[key] = value


if __name__ == "__main__":
    unittest.main()
