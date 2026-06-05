from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Action(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ALLOW: _ClassVar[Action]
    BLOCK: _ClassVar[Action]
    MASK: _ClassVar[Action]
ALLOW: Action
BLOCK: Action
MASK: Action

class PromptRequest(_message.Message):
    __slots__ = ("request_id", "tenant_id", "prompt", "model")
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    TENANT_ID_FIELD_NUMBER: _ClassVar[int]
    PROMPT_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    request_id: str
    tenant_id: str
    prompt: str
    model: str
    def __init__(self, request_id: _Optional[str] = ..., tenant_id: _Optional[str] = ..., prompt: _Optional[str] = ..., model: _Optional[str] = ...) -> None: ...

class ThreatDetail(_message.Message):
    __slots__ = ("type", "confidence", "description")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    CONFIDENCE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    type: str
    confidence: float
    description: str
    def __init__(self, type: _Optional[str] = ..., confidence: _Optional[float] = ..., description: _Optional[str] = ...) -> None: ...

class AnalysisResult(_message.Message):
    __slots__ = ("request_id", "action", "risk_score", "pii_detected", "masked_prompt", "threats", "reason")
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    RISK_SCORE_FIELD_NUMBER: _ClassVar[int]
    PII_DETECTED_FIELD_NUMBER: _ClassVar[int]
    MASKED_PROMPT_FIELD_NUMBER: _ClassVar[int]
    THREATS_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    request_id: str
    action: Action
    risk_score: float
    pii_detected: bool
    masked_prompt: str
    threats: _containers.RepeatedCompositeFieldContainer[ThreatDetail]
    reason: str
    def __init__(self, request_id: _Optional[str] = ..., action: _Optional[_Union[Action, str]] = ..., risk_score: _Optional[float] = ..., pii_detected: _Optional[bool] = ..., masked_prompt: _Optional[str] = ..., threats: _Optional[_Iterable[_Union[ThreatDetail, _Mapping]]] = ..., reason: _Optional[str] = ...) -> None: ...
