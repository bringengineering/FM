"""건축물대장 커넥터 파싱·URL·조회 테스트 (실제 키·네트워크 없이)."""

from __future__ import annotations

import json
from decimal import Decimal

import pytest

from valuescope.connectors import building_registry as br

# 건축HUB 표제부(getBrTitleInfo) 응답 형태의 샘플 (원룸·다가구 예시)
SAMPLE_ITEM = {
    "platPlc": "강원특별자치도 원주시 무실동 1234",
    "newPlatPlc": "강원특별자치도 원주시 무실로 12",
    "bldNm": "무실동 원룸",
    "platArea": "330.5",
    "archArea": "180.2",
    "totArea": "820.75",
    "bcRat": "54.5",
    "vlRat": "248.3",
    "grndFlrCnt": "5",
    "ugrndFlrCnt": "1",
    "mainPurpsCdNm": "다가구주택",
    "strctCdNm": "철근콘크리트구조",
    "useAprDay": "20180514",
    "hhldCnt": "0",
    "hoCnt": "12",
    "fmlyCnt": "12",
    "indrAutoUtcnt": "4",
    "oudrAutoUtcnt": "2",
    "indrMechUtcnt": "0",
    "oudrMechUtcnt": "0",
    "rserthqkDsgnApplyYn": "Y",
    "engrGrade": "2",
}


def wrap(items):
    return json.dumps({
        "response": {
            "header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE."},
            "body": {"items": {"item": items}, "numOfRows": 10, "pageNo": 1, "totalCount": len(items) if isinstance(items, list) else 1},
        }
    })


def test_parse_maps_core_fields():
    b = br.parse_title_item(SAMPLE_ITEM)
    assert b.total_floor_area_m2 == Decimal("820.75")
    assert b.plat_area_m2 == Decimal("330.5")
    assert b.building_coverage_ratio == Decimal("54.5")
    assert b.floor_area_ratio == Decimal("248.3")
    assert b.floors_above == 5 and b.floors_below == 1
    assert b.main_use == "다가구주택"
    assert b.approval_date == "20180514"
    assert b.unit_cnt == 12
    assert b.address_road == "강원특별자치도 원주시 무실로 12"


def test_parse_parking_sums_utcnt():
    b = br.parse_title_item(SAMPLE_ITEM)
    assert b.parking_total == 6  # 4 + 2 + 0 + 0


def test_parse_uses_totpkngcnt_when_no_utcnt():
    item = {"totPkngCnt": "8"}
    assert br.parse_title_item(item).parking_total == 8


def test_parse_empty_strings_become_none():
    item = {"totArea": "", "bcRat": "  ", "grndFlrCnt": ""}
    b = br.parse_title_item(item)
    assert b.total_floor_area_m2 is None
    assert b.building_coverage_ratio is None
    assert b.floors_above is None


def test_source_and_confidence_metadata():
    b = br.parse_title_item(SAMPLE_ITEM)
    assert "건축물대장" in b.source
    assert b.confidence == "B"
    assert b.raw["bldNm"] == "무실동 원룸"


def test_build_url_includes_key_codes_and_json():
    url = br.build_title_url("MYKEY", "51130", "10800", bun=1234, ji=0)
    assert "serviceKey=MYKEY" in url
    assert "sigunguCd=51130" in url
    assert "bjdongCd=10800" in url
    assert "_type=json" in url
    assert "bun=1234" in url  # padded to 4


def test_build_url_pads_bun_ji_to_four():
    url = br.build_title_url("K", "51130", "10800", bun="12", ji="3")
    assert "bun=0012" in url
    assert "ji=0003" in url


def test_fetch_building_parses_first_item():
    calls = {}
    def fake_get(url):
        calls["url"] = url
        return wrap(SAMPLE_ITEM)
    b = br.fetch_building("51130", "10800", 1234, 0, service_key="K", http_get=fake_get)
    assert b.unit_cnt == 12
    assert "serviceKey=K" in calls["url"]


def test_fetch_building_handles_list_items():
    b = br.fetch_building("51130", "10800", service_key="K",
                          http_get=lambda u: wrap([SAMPLE_ITEM, {"bldNm": "다른동"}]))
    assert b.building_name == "무실동 원룸"  # first item


def test_fetch_building_empty_returns_none():
    empty = json.dumps({"response": {"header": {"resultCode": "00"}, "body": {"items": ""}}})
    assert br.fetch_building("51130", "10800", service_key="K", http_get=lambda u: empty) is None


def test_fetch_building_error_code_raises():
    err = json.dumps({"response": {"header": {"resultCode": "30", "resultMsg": "SERVICE KEY IS NOT REGISTERED"}}})
    with pytest.raises(br.BuildingRegistryError):
        br.fetch_building("51130", "10800", service_key="K", http_get=lambda u: err)


def test_fetch_building_missing_key_raises(monkeypatch):
    monkeypatch.delenv("DATA_GO_KR_SERVICE_KEY", raising=False)
    with pytest.raises(br.BuildingRegistryError):
        br.fetch_building("51130", "10800", http_get=lambda u: wrap(SAMPLE_ITEM))
