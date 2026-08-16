from pathlib import Path
import json
import subprocess
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parent
FRAMES_ROOT = ROOT / "frames"
FRAMES_ROOT.mkdir(exist_ok=True)
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
manifest = {}

for index in range(1, 5):
    source = ROOT / f"{index}.mp4"
    target_dir = FRAMES_ROOT / str(index)
    target_dir.mkdir(parents=True, exist_ok=True)

    for old in target_dir.glob("*.jpg"):
        old.unlink()

    fps = 24
    output_pattern = target_dir / "%04d.jpg"
    command = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel", "warning",
        "-i", str(source),
        "-vf", "fps=24,scale=1280:-2:flags=lanczos",
        "-q:v", "4",
        "-start_number", "0",
        str(output_pattern),
    ]

    print(f"Extracting video {index} at {fps} fps...", flush=True)
    subprocess.run(command, check=True)

    generated = sorted(target_dir.glob("*.jpg"))
    manifest[str(index)] = {
        "count": len(generated),
        "fps": fps,
        "width": 1280,
        "pattern": f"./frames/{index}/{{frame}}.jpg",
    }
    print(f"Video {index}: {len(generated)} frames", flush=True)

(ROOT / "frames-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print("Frame extraction complete.")
