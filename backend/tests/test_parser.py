from chatbot.parser import parse_command


def test_add_entity():
    parsed = parse_command("Add Student entity")
    assert parsed["ok"]
    cmd = parsed["command"]
    assert cmd["action"] == "ADD_NODE"
    assert cmd["payload"]["type"] == "entity"
    assert cmd["payload"]["label"] == "Student"


def test_delete_node_by_label():
    parsed = parse_command("Delete Student")
    assert parsed["ok"]
    assert parsed["command"]["action"] == "DELETE_NODE"
    assert parsed["command"]["payload"]["label"] == "Student"


def test_delete_by_type():
    parsed = parse_command("Delete the diamond")
    assert parsed["ok"]
    cmd = parsed["command"]
    assert cmd["action"] == "DELETE_BY_TYPE"
    assert cmd["payload"]["type"] == "diamond"


def test_rename():
    parsed = parse_command("Rename Student to Customer")
    assert parsed["ok"]
    assert parsed["command"]["action"] == "EDIT_TEXT"
    assert parsed["command"]["payload"]["from"] == "Student"
    assert parsed["command"]["payload"]["to"] == "Customer"


def test_add_attribute():
    parsed = parse_command("Add Name attribute to Student")
    assert parsed["ok"]
    assert parsed["command"]["action"] == "ADD_ATTRIBUTE"


def test_connect_and_disconnect():
    connect = parse_command("Connect Student to Course")
    assert connect["ok"]
    assert connect["command"]["action"] == "CONNECT"

    disconnect = parse_command("Disconnect Student from Course")
    assert disconnect["ok"]
    assert disconnect["command"]["action"] == "DISCONNECT"


def test_move_directions():
    parsed = parse_command("Move Student left")
    assert parsed["ok"]
    assert parsed["command"]["action"] == "MOVE_NODE"
    assert parsed["command"]["payload"]["delta"] == {"x": -80, "y": 0}


def test_change_color():
    parsed = parse_command("Change Student color to red")
    assert parsed["ok"]
    assert parsed["command"]["action"] == "RECOLOR"
    assert parsed["command"]["payload"]["fill"] == "#8b3a3a"


def test_undo_redo_meta():
    assert parse_command("undo")["meta"]["history"] == "undo"
    assert parse_command("redo")["meta"]["history"] == "redo"


def test_invalid_command_rejected():
    parsed = parse_command("do a backflip")
    assert not parsed["ok"]


def test_sanitizes_angle_brackets():
    parsed = parse_command("Add <script>alert(1)</script> entity")
    assert parsed["ok"]
    assert "<" not in parsed["command"]["payload"]["label"]
    assert ">" not in parsed["command"]["payload"]["label"]
