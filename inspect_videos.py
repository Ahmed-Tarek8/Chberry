from pathlib import Path
import imageio_ffmpeg

root = Path(__file__).resolve().parent
for index in range(1, 5):
    path = root / f"{index}.mp4"
    frames, seconds = imageio_ffmpeg.count_frames_and_secs(str(path))
    print(index, frames, seconds, frames / seconds if seconds else 0)
