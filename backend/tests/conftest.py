"""Point the app at a throwaway data dir before any app module is imported."""
import os
import tempfile

os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="pitchstudio-test-")
