import unittest

from stripe_provider_test import require_test_key


class StripeProviderSafetyTests(unittest.TestCase):
    def test_accepts_only_test_keys(self):
        self.assertEqual(require_test_key("sk_test_example"), "sk_test_example")
        self.assertEqual(require_test_key("rk_test_example"), "rk_test_example")

    def test_rejects_live_and_unknown_keys(self):
        for value in ("", "sk_live_example", "rk_live_example", "not-a-key"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                require_test_key(value)


if __name__ == "__main__":
    unittest.main()
