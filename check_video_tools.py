import importlib.util

print('imageio_ffmpeg', bool(importlib.util.find_spec('imageio_ffmpeg')))
print('cv2', bool(importlib.util.find_spec('cv2')))
