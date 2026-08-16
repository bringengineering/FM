import json
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.request import urlopen


class StandaloneMarketingAppTests(unittest.TestCase):
    def test_package_uses_local_data_directory(self):
        from app.config import Settings

        root = Path(__file__).resolve().parents[1]
        settings = Settings.from_env(root=root)
        self.assertEqual(root / "data" / "marketing_os.db", settings.db_path)

    def test_health_payload_identifies_marketing_os(self):
        from app.server import health_payload

        payload = health_payload()
        self.assertEqual("ok", payload["status"])
        self.assertEqual("BRING Marketing OS", payload["service"])
        self.assertIn("version", payload)

    def test_server_serves_dashboard_blog_and_web_app(self):
        from app.server import create_server

        with tempfile.TemporaryDirectory() as temp_dir:
            server = create_server("127.0.0.1", 0, Path(temp_dir) / "test.db", seed=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            base = f"http://127.0.0.1:{server.server_port}"
            try:
                with urlopen(base + "/api/dashboard") as response:
                    dashboard = json.load(response)
                with urlopen(base + "/api/blog") as response:
                    blog = json.load(response)
                with urlopen(base + "/") as response:
                    page = response.read().decode("utf-8")
                self.assertTrue(dashboard["topics"])
                self.assertTrue(blog["brands"])
                self.assertIn("Marketing OS", page)
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)

    def test_windows_app_stores_database_in_local_app_data(self):
        from unittest.mock import patch
        from app.windows_launcher import windows_data_root

        with patch.dict("os.environ", {"LOCALAPPDATA": r"C:\Users\tester\AppData\Local"}):
            self.assertEqual(
                Path(r"C:\Users\tester\AppData\Local\BRING\MarketingOS"),
                windows_data_root(),
            )


if __name__ == "__main__":
    unittest.main()
