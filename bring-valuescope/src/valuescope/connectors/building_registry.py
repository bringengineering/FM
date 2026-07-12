"""건축HUB 건축물대장/건축인허가 커넥터.

국토교통부 건축HUB API(data.go.kr)에서 표제부·총괄표제부를 받아 ValueScope의
``BuildingRegistry`` 도메인 객체로 매핑한다.

보안 원칙:
- data.go.kr serviceKey는 **환경변수(DATA_GO_KR_SERVICE_KEY)에서만** 읽는다.
  코드·저장소에 하드코딩하지 않는다.
- 모든 외부 값에는 출처·기준일·신뢰등급을 함께 저장한다(CLAUDE.md 규칙).

API 기준: 국토교통부_건축HUB_건축물대장정보 서비스 (data.go.kr 15134735)
Base URL: apis.data.go.kr/1613000/BldRgstHubService
"""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Callable, Optional

BLD_BASE = "https://apis.data.go.kr/1613000/BldRgstHubService"
PMS_BASE = "https://apis.data.go.kr/1613000/ArchPmsHubService"

SOURCE = "건축HUB 건축물대장 (data.go.kr 15134735)"
CONFIDENCE_PUBLIC = "B"  # 공공데이터 신뢰등급


def _dec(value) -> Optional[Decimal]:
    if value is None:
        return None
    s = str(value).strip()
    if s == "":
        return None
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def _int(value) -> Optional[int]:
    d = _dec(value)
    return int(d) if d is not None else None


def _str(value) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


@dataclass(frozen=True)
class BuildingRegistry:
    """건축물대장 표제부에서 추출한 건물 식별·규모 정보."""

    address_jibun: Optional[str]          # 지번주소 platPlc
    address_road: Optional[str]           # 도로명주소 newPlatPlc
    building_name: Optional[str]          # 건물명 bldNm
    plat_area_m2: Optional[Decimal]       # 대지면적 platArea
    arch_area_m2: Optional[Decimal]       # 건축면적 archArea
    total_floor_area_m2: Optional[Decimal]  # 연면적 totArea
    building_coverage_ratio: Optional[Decimal]  # 건폐율(%) bcRat
    floor_area_ratio: Optional[Decimal]   # 용적률(%) vlRat
    floors_above: Optional[int]           # 지상층수 grndFlrCnt
    floors_below: Optional[int]           # 지하층수 ugrndFlrCnt
    main_use: Optional[str]               # 주용도 mainPurpsCdNm
    structure: Optional[str]              # 구조 strctCdNm
    approval_date: Optional[str]          # 사용승인일 useAprDay (YYYYMMDD)
    household_cnt: Optional[int]          # 세대수 hhldCnt
    unit_cnt: Optional[int]               # 호수 hoCnt
    family_cnt: Optional[int]             # 가구수 fmlyCnt
    parking_total: Optional[int]          # 총 주차대수 (자주식+기계식 합)
    seismic_applied: Optional[str]        # 내진설계 적용여부 rserthqkDsgnApplyYn
    energy_grade: Optional[str]           # 에너지효율등급 engrGrade
    source: str = SOURCE
    confidence: str = CONFIDENCE_PUBLIC
    raw: dict = field(default_factory=dict)


def _parking_total(item: dict) -> Optional[int]:
    keys = ("indrMechUtcnt", "oudrMechUtcnt", "indrAutoUtcnt", "oudrAutoUtcnt")
    vals = [_int(item.get(k)) for k in keys]
    present = [v for v in vals if v is not None]
    if not present:
        return _int(item.get("totPkngCnt"))  # 총괄표제부엔 totPkngCnt가 있음
    return sum(present)


def parse_title_item(item: dict) -> BuildingRegistry:
    """getBrTitleInfo / getBrRecapTitleInfo 의 item 하나를 도메인으로 매핑."""
    return BuildingRegistry(
        address_jibun=_str(item.get("platPlc")),
        address_road=_str(item.get("newPlatPlc")),
        building_name=_str(item.get("bldNm")),
        plat_area_m2=_dec(item.get("platArea")),
        arch_area_m2=_dec(item.get("archArea")),
        total_floor_area_m2=_dec(item.get("totArea")),
        building_coverage_ratio=_dec(item.get("bcRat")),
        floor_area_ratio=_dec(item.get("vlRat")),
        floors_above=_int(item.get("grndFlrCnt")),
        floors_below=_int(item.get("ugrndFlrCnt")),
        main_use=_str(item.get("mainPurpsCdNm")),
        structure=_str(item.get("strctCdNm")),
        approval_date=_str(item.get("useAprDay")),
        household_cnt=_int(item.get("hhldCnt")),
        unit_cnt=_int(item.get("hoCnt")),
        family_cnt=_int(item.get("fmlyCnt")),
        parking_total=_parking_total(item),
        seismic_applied=_str(item.get("rserthqkDsgnApplyYn")),
        energy_grade=_str(item.get("engrGrade")),
        raw=dict(item),
    )


def _pad4(value: str | int | None) -> str:
    s = str(value or "").strip()
    if s == "":
        return ""
    return s.zfill(4) if s.isdigit() else s


def build_title_url(
    service_key: str,
    sigungu_cd: str,
    bjdong_cd: str,
    bun: str | int = "",
    ji: str | int = "",
    *,
    plat_gb_cd: str = "0",
    num_of_rows: int = 10,
    page_no: int = 1,
    endpoint: str = "getBrTitleInfo",
    base_url: str = BLD_BASE,
) -> str:
    """표제부 조회 URL 생성. service_key 는 data.go.kr **Decoding** 인증키."""
    params = {
        "serviceKey": service_key,
        "sigunguCd": sigungu_cd,
        "bjdongCd": bjdong_cd,
        "platGbCd": plat_gb_cd,
        "bun": _pad4(bun),
        "ji": _pad4(ji),
        "_type": "json",
        "numOfRows": str(num_of_rows),
        "pageNo": str(page_no),
    }
    return f"{base_url}/{endpoint}?" + urllib.parse.urlencode(params)


def _default_http_get(url: str) -> str:
    with urllib.request.urlopen(url, timeout=15) as resp:  # noqa: S310 - https only
        return resp.read().decode("utf-8")


def _items_from_response(payload: dict) -> list[dict]:
    header = (payload.get("response", payload).get("header") or {})
    code = header.get("resultCode")
    if code not in (None, "00", "0"):
        raise BuildingRegistryError(header.get("resultMsg") or f"resultCode={code}")
    body = payload.get("response", payload).get("body") or {}
    items = (body.get("items") or {})
    item = items.get("item") if isinstance(items, dict) else items
    if item is None:
        return []
    return item if isinstance(item, list) else [item]


class BuildingRegistryError(RuntimeError):
    """건축HUB API 오류 응답."""


def fetch_building(
    sigungu_cd: str,
    bjdong_cd: str,
    bun: str | int = "",
    ji: str | int = "",
    *,
    service_key: Optional[str] = None,
    http_get: Callable[[str], str] = _default_http_get,
    endpoint: str = "getBrTitleInfo",
    base_url: str = BLD_BASE,
) -> Optional[BuildingRegistry]:
    """법정동코드+번지로 건축물대장 표제부를 조회해 첫 건물을 반환.

    service_key 미지정 시 환경변수 DATA_GO_KR_SERVICE_KEY 를 사용한다.
    결과가 없으면 None, API가 오류코드를 주면 BuildingRegistryError.
    """
    key = service_key or os.environ.get("DATA_GO_KR_SERVICE_KEY")
    if not key:
        raise BuildingRegistryError(
            "serviceKey 미설정 — 환경변수 DATA_GO_KR_SERVICE_KEY 를 설정하세요 (저장소에 넣지 말 것)."
        )
    url = build_title_url(key, sigungu_cd, bjdong_cd, bun, ji, endpoint=endpoint, base_url=base_url)
    raw = http_get(url)
    payload = json.loads(raw)
    items = _items_from_response(payload)
    return parse_title_item(items[0]) if items else None


__all__ = [
    "BuildingRegistry",
    "BuildingRegistryError",
    "parse_title_item",
    "build_title_url",
    "fetch_building",
    "BLD_BASE",
    "PMS_BASE",
]
