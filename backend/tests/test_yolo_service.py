"""The trained flowchart detector: class mapping, geometry, lazy loading, failures.

No test here needs a GPU, the real weights, or the network: the Ultralytics model
is replaced through the single loader seam (``yolo_service._create_model``), and
detections are injected in the same shape a real ``Results`` object provides.
"""

import io
import os

import pytest
from PIL import Image

from recognition import yolo_service
from recognition.yolo_service import YoloError


def png_bytes(width=640, height=480):
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (245, 245, 245)).save(buf, format="PNG")
    return buf.getvalue()


class _Tensor:
    """Stands in for the torch tensors a real result carries."""

    def __init__(self, rows):
        self._rows = rows

    def tolist(self):
        return self._rows

    def cpu(self):
        return self


class _Boxes:
    """Ultralytics' real tensor shapes: xyxy is (n, 4), conf and cls are flat (n,)."""

    def __init__(self, rows):
        self.xyxy = _Tensor([row[:4] for row in rows])
        self.conf = _Tensor([row[4] for row in rows])
        self.cls = _Tensor([row[5] for row in rows])

    def __len__(self):
        return len(self.xyxy._rows)


class _BoxesTwoDimensional(_Boxes):
    """Older releases hand conf/cls over as (n, 1) columns; both must work."""

    def __init__(self, rows):
        super().__init__(rows)
        self.conf = _Tensor([[row[4]] for row in rows])
        self.cls = _Tensor([[row[5]] for row in rows])


class _Result:
    def __init__(self, rows, boxes=None):
        self.boxes = (boxes or _Boxes)(rows)


class _FakeModel:
    """A model that answers with fixed detections and records how it was called."""

    def __init__(self, rows=(), names=None, boxes=None):
        # class 2 = data, 3 = decision, 4 = process, 5 = terminator, 0/1 = connectors
        self.boxes_type = boxes
        self.rows = list(rows) or [
            [100, 100, 300, 180, 0.91, 4],
            [120, 260, 280, 380, 0.83, 3],
            [400, 100, 560, 180, 0.77, 2],
            [60, 40, 200, 90, 0.72, 5],
            [120, 190, 140, 250, 0.66, 0],
            [125, 230, 145, 252, 0.61, 1],
        ]
        self.names = names if names is not None else {4: "process", 3: "decision", 2: "data", 5: "terminator", 0: "arrow", 1: "arrowhead"}
        self.calls = []
        self.ckpt_path = "backend/models/flowchart/best.pt"

    def predict(self, **kwargs):
        self.calls.append(kwargs)
        return [_Result(self.rows, self.boxes_type)]


class _FailingModel:
    def predict(self, **kwargs):
        raise RuntimeError("CUDA out of memory at C:\\secret\\path")


# Captured before any fixture patches it, so the path-resolution test exercises
# the real resolver rather than the test double.
_real_weights_path = yolo_service.weights_path


@pytest.fixture(autouse=True)
def _clean_state(monkeypatch, tmp_path):
    """Never touch real weights or a real device, and start from an unloaded model."""
    yolo_service.reset_model_cache()
    weights = tmp_path / "best.pt"
    weights.write_bytes(b"stub weights")
    monkeypatch.setattr(yolo_service, "weights_path", lambda: weights)
    yield
    yolo_service.reset_model_cache()


def _use(monkeypatch, model):
    monkeypatch.setattr(yolo_service, "_create_model", lambda path: model)
    monkeypatch.setattr(yolo_service, "resolve_device", lambda requested=None: "cpu")
    return model


# --- class mapping -----------------------------------------------------------


def test_class_names_come_from_the_checkpoint(monkeypatch):
    """Ids are never assumed: the model's own mapping decides the classes."""
    names = {0: "process", 1: "decision", 2: "terminator", 3: "data", 4: "arrow", 5: "arrowhead"}
    _use(monkeypatch, _FakeModel(rows=[[10, 10, 90, 60, 0.9, 0]], names=names))
    result = yolo_service.detect(png_bytes())
    assert result["class_counts"] == {"process": 1}
    assert result["symbols"][0]["class_name"] == "process"


def test_class_names_accept_a_list_mapping():
    assert yolo_service.class_names(_FakeModel(names=["arrow", "arrowhead", "data"])) == {
        0: "arrow",
        1: "arrowhead",
        2: "data",
    }


def test_data_maps_to_the_io_node_type(monkeypatch):
    _use(monkeypatch, _FakeModel(rows=[[10, 10, 120, 70, 0.8, 2]]))
    result = yolo_service.detect(png_bytes())
    nodes = yolo_service.symbols_to_nodes(result["symbols"])
    assert nodes[0]["type"] == "io"
    assert yolo_service.symbol_type("data") == "io"


def test_every_trained_symbol_maps_into_the_flowchart_vocabulary():
    assert yolo_service.symbol_type("process") == "process"
    assert yolo_service.symbol_type("decision") == "decision"
    assert yolo_service.symbol_type("terminator") == "terminator"
    assert yolo_service.symbol_type("arrow") is None
    assert yolo_service.symbol_type("arrowhead") is None


# --- detections --------------------------------------------------------------


def test_conf_and_cls_are_read_in_either_tensor_shape(monkeypatch):
    """Real results hand conf/cls over flat; older ones as (n, 1) columns."""
    rows = [[100, 100, 300, 180, 0.91, 4]]
    for boxes in (_Boxes, _BoxesTwoDimensional):
        yolo_service.reset_model_cache()
        _use(monkeypatch, _FakeModel(rows=rows, boxes=boxes))
        detections = yolo_service.detect(png_bytes())["detections"]
        assert len(detections) == 1, boxes.__name__
        assert detections[0]["class_id"] == 4
        assert detections[0]["confidence"] == 0.91
        assert detections[0]["bbox"] == [100.0, 100.0, 300.0, 180.0]


def test_detections_keep_boxes_and_confidence(monkeypatch):
    _use(monkeypatch, _FakeModel(rows=[[100, 100, 300, 180, 0.912, 4]]))
    symbol = yolo_service.detect(png_bytes())["symbols"][0]
    assert symbol["bbox"] == [100.0, 100.0, 300.0, 180.0]
    assert symbol["confidence"] == 0.912
    assert symbol["class_id"] == 4


def test_symbols_are_ordered_by_reading_position(monkeypatch):
    _use(
        monkeypatch,
        _FakeModel(
            rows=[
                [400, 300, 500, 360, 0.7, 4],
                [50, 40, 150, 100, 0.6, 4],
                [300, 40, 380, 100, 0.9, 4],
            ]
        ),
    )
    symbols = yolo_service.detect(png_bytes())["symbols"]
    assert [s["bbox"][0] for s in symbols] == [50.0, 300.0, 400.0]


def test_arrows_and_arrowheads_are_connector_evidence_not_nodes(monkeypatch):
    _use(monkeypatch, _FakeModel())
    result = yolo_service.detect(png_bytes())
    assert {c["class_name"] for c in result["connectors"]} == {"arrow", "arrowhead"}
    nodes = yolo_service.symbols_to_nodes(result["symbols"])
    assert {n["type"] for n in nodes} == {"process", "decision", "io", "terminator"}
    assert all(n["type"] not in {"arrow", "arrowhead"} for n in nodes)


def test_node_ids_are_deterministic_and_unique(monkeypatch):
    _use(monkeypatch, _FakeModel())
    nodes = yolo_service.symbols_to_nodes(yolo_service.detect(png_bytes())["symbols"])
    ids = [n["id"] for n in nodes]
    assert ids == ["yolo_n1", "yolo_n2", "yolo_n3", "yolo_n4"]
    assert len(set(ids)) == len(ids)


def test_symbols_without_text_get_placeholder_labels(monkeypatch):
    _use(monkeypatch, _FakeModel(rows=[[10, 10, 90, 60, 0.9, 4], [10, 90, 90, 140, 0.9, 4]]))
    nodes = yolo_service.symbols_to_nodes(yolo_service.detect(png_bytes())["symbols"])
    assert [n["label"] for n in nodes] == ["Process 1", "Process 2"]
    assert all(n["placeholder"] for n in nodes)


# --- loading and settings ----------------------------------------------------


def test_model_is_loaded_once_and_reused(monkeypatch):
    model = _use(monkeypatch, _FakeModel())
    loads = []
    monkeypatch.setattr(yolo_service, "_create_model", lambda path: (loads.append(path), model)[1])
    yolo_service.detect(png_bytes())
    yolo_service.detect(png_bytes())
    assert len(loads) == 1
    assert len(model.calls) == 2


def test_missing_weights_are_reported(monkeypatch):
    monkeypatch.setattr(yolo_service, "weights_path", lambda: yolo_service.BACKEND_DIR / "models" / "flowchart" / "absent.pt")
    with pytest.raises(YoloError) as excinfo:
        yolo_service.detect(png_bytes())
    assert excinfo.value.code == "missing_weights"
    assert excinfo.value.status == 503
    assert "SMARTSKETCH_YOLO_MODEL" in str(excinfo.value)


def test_empty_weights_file_is_reported(monkeypatch):
    path = yolo_service.BACKEND_DIR / "models" / "flowchart" / "empty.pt"
    path.write_bytes(b"")
    monkeypatch.setattr(yolo_service, "weights_path", lambda: path)
    with pytest.raises(YoloError) as excinfo:
        yolo_service.detect(png_bytes())
    assert excinfo.value.code == "missing_weights"


def test_missing_ultralytics_dependency_is_reported(monkeypatch):
    def _boom(path):
        raise ImportError("No module named 'ultralytics'")

    monkeypatch.setattr(yolo_service, "_create_model", _boom)
    with pytest.raises(YoloError) as excinfo:
        yolo_service.detect(png_bytes())
    assert excinfo.value.code == "missing_dependency"
    assert "ultralytics" in str(excinfo.value)


def test_broken_weights_are_reported_without_leaking_the_exception(monkeypatch):
    def _boom(path):
        raise RuntimeError("unpickling failed for C:\\Users\\someone\\secret.joblib")

    monkeypatch.setattr(yolo_service, "_create_model", _boom)
    with pytest.raises(YoloError) as excinfo:
        yolo_service.detect(png_bytes())
    assert excinfo.value.code == "model_load_failed"
    assert "secret.joblib" not in str(excinfo.value)


def test_invalid_image_is_reported_before_loading(monkeypatch):
    model = _use(monkeypatch, _FakeModel())
    with pytest.raises(YoloError) as excinfo:
        yolo_service.detect(b"definitely not an image")
    assert excinfo.value.code == "invalid_image"
    assert excinfo.value.status == 400
    assert model.calls == []


def test_inference_failure_is_reported_without_leaking_the_exception(monkeypatch):
    _use(monkeypatch, _FailingModel())
    with pytest.raises(YoloError) as excinfo:
        yolo_service.detect(png_bytes())
    assert excinfo.value.code == "inference_failed"
    assert "secret" not in str(excinfo.value)


def test_inference_settings_are_configurable(monkeypatch):
    model = _use(monkeypatch, _FakeModel())
    monkeypatch.setenv("SMARTSKETCH_YOLO_IMGSZ", "960")
    monkeypatch.setenv("SMARTSKETCH_YOLO_CONF", "0.4")
    monkeypatch.setenv("SMARTSKETCH_YOLO_DEVICE", "cpu")
    result = yolo_service.detect(png_bytes())
    call = model.calls[0]
    assert call["imgsz"] == 960
    assert call["conf"] == 0.4
    assert call["device"] == "cpu"
    assert result["imgsz"] == 960 and result["conf"] == 0.4


def test_defaults_follow_the_requested_spec(monkeypatch):
    monkeypatch.delenv("SMARTSKETCH_YOLO_IMGSZ", raising=False)
    monkeypatch.delenv("SMARTSKETCH_YOLO_CONF", raising=False)
    settings = yolo_service.settings()
    assert settings["imgsz"] == 640
    assert settings["conf"] == 0.25
    assert settings["device"] == "auto"


def test_explicit_device_is_honoured():
    assert yolo_service.resolve_device("cpu") == "cpu"
    assert yolo_service.resolve_device("0") == "0"
    # "auto" resolves to something Ultralytics accepts, whatever this machine has.
    assert yolo_service.resolve_device("auto") in {"cpu", "cuda:0"}


def test_relative_model_path_resolves_against_the_backend(monkeypatch):
    """The Flask process may be launched from anywhere; the default path must not move."""
    monkeypatch.setenv("SMARTSKETCH_YOLO_MODEL", "models/flowchart/best.pt")
    monkeypatch.chdir(os.path.dirname(yolo_service.BACKEND_DIR))
    resolved = _real_weights_path()
    assert resolved.parent.parent.parent == yolo_service.BACKEND_DIR
    assert resolved.name == "best.pt"
    assert resolved.is_absolute()


def test_detector_can_be_disabled_by_configuration(monkeypatch):
    monkeypatch.setenv("SMARTSKETCH_YOLO_ENABLED", "false")
    assert yolo_service.enabled() is False
    monkeypatch.setenv("SMARTSKETCH_YOLO_ENABLED", "true")
    assert yolo_service.enabled() is True
    monkeypatch.delenv("SMARTSKETCH_YOLO_ENABLED", raising=False)
    assert yolo_service.enabled() is True


def test_model_info_reports_readiness_without_loading(monkeypatch):
    monkeypatch.setattr(yolo_service, "_create_model", lambda path: pytest.fail("model must not load"))
    info = yolo_service.model_info()
    assert info["present"] is True
    assert info["loaded"] is False
    assert info["weights"] == "best.pt"
    assert info["enabled"] is True
