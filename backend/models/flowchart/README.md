# Flowchart symbol detector

`best.pt` — the trained YOLO11n flowchart model — belongs in this directory.

The weights are **not** committed (see `.gitignore`: `backend/models/**/*.pt`).
To install a freshly trained model, copy it here, keeping the filename:

```powershell
Copy-Item "C:\smartsketch-2\runs\flowchart\yolo11n_v1\weights\best.pt" `
          "C:\smartsketch\backend\models\flowchart\best.pt" -Force
```

The backend reads `SMARTSKETCH_YOLO_MODEL` (relative paths resolve against
`backend/`, never against the current working directory) and falls back to
`backend/models/flowchart/best.pt`.

Six trained classes: `arrow`, `arrowhead`, `data`, `decision`, `process`,
`terminator`. The class names are read from the checkpoint, so a re-trained
model with the same names — or a different class order — needs no code change.
See `backend/recognition/yolo_service.py`.
