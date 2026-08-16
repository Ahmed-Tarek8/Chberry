from pathlib import Path
import subprocess
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parent
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()

for index in range(1, 5):
    source = ROOT / f"{index}.mp4"
    target = ROOT / f"{index}-scroll.mp4"

    command = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel", "warning",
        "-i", str(source),
        "-an",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "22",
        "-g", "1",
        "-keyint_min", "1",
        "-sc_threshold", "0",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(target),
    ]

    print(f"Encoding {source.name} -> {target.name}", flush=True)
    subprocess.run(command, check=True)

print("Finished creating scroll-optimized videos.")
