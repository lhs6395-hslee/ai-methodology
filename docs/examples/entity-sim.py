#!/usr/bin/env python3
"""SPEC-033 ③층 후보 생성기 예시 — entityRegistry를 임베딩해 유사 쌍을 뽑는다.

킷의 일부가 아니다(게이트도 아니고 소유 키도 없다). 프로젝트가 복사해 쓰는 참고
구현이며, 지키는 계약은 하나뿐이다: **stdout 한 줄 = 후보 쌍 하나** (탭 구분,
3번째 칸은 선택적 점수). 실패하면 비-0으로 죽어라 — 게이트가 skipped(사유)로
기록한다("후보 없음"으로 오독되지 않는다).

    "entitySimilarityCommand": "python docs/examples/entity-sim.py --threshold 0.82"

백엔드 두 가지 (둘 다 무료·로컬·오프라인 가능):
  model2vec  기본. 정적 임베딩(MIT, 의존성 사실상 numpy, CPU에서 매우 빠름).
             pip install model2vec  ·  minishlab/potion-multilingual-128M (101개 언어)
  ollama     이미 Ollama를 쓰는 환경. ollama pull embeddinggemma  ·  POST /api/embed
             API 키 없음, 토큰 비용 0.

임계값은 **프로젝트가 실측해서** 정한다. 정답을 아는 쌍(이미 통합한 적 있는 이름들)을
심어 순위를 보고, 그 쌍들이 오탐보다 위에 오는 지점을 고른다. 임계값을 낮게 잡으면
미결 후보가 쏟아지고, 후보 하나는 곧 사람이 쓸 사유 한 줄이다.
"""
import argparse, itertools, json, sys, urllib.request


def load_entities(cfg_path):
    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)
    reg = cfg.get("entityRegistry") or {}
    if not reg:
        sys.exit("entityRegistry가 비어 있다 — 판정할 대상이 없다")
    # 이름만으로는 신호가 약하다(그건 ①층이 이미 본다). 설명문을 붙여 의미를 준다.
    return [(k, f"{k}: {v}") for k, v in sorted(reg.items())]


def embed_model2vec(texts, model):
    from model2vec import StaticModel  # pip install model2vec
    return StaticModel.from_pretrained(model).encode(texts)


def embed_ollama(texts, model, host):
    body = json.dumps({"model": model, "input": texts}).encode()
    req = urllib.request.Request(f"{host}/api/embed", body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)["embeddings"]


def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(x * x for x in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--config", default="sdd.config.json")
    p.add_argument("--backend", choices=["model2vec", "ollama"], default="model2vec")
    p.add_argument("--model", default=None)
    p.add_argument("--ollama-host", default="http://localhost:11434")
    p.add_argument("--threshold", type=float, default=0.85)
    p.add_argument("--top", type=int, default=0, help="0이면 임계값만 적용, N이면 상위 N쌍으로 더 자른다")
    p.add_argument("--rank", action="store_true", help="후보 대신 전 쌍 순위를 stderr에 찍는다(임계값 고르기용)")
    a = p.parse_args()

    keys_texts = load_entities(a.config)
    keys = [k for k, _ in keys_texts]
    texts = [t for _, t in keys_texts]

    if a.backend == "model2vec":
        vecs = embed_model2vec(texts, a.model or "minishlab/potion-multilingual-128M")
        vecs = [list(map(float, v)) for v in vecs]
    else:
        vecs = embed_ollama(texts, a.model or "embeddinggemma", a.ollama_host)

    pairs = []
    for i, j in itertools.combinations(range(len(keys)), 2):
        x, y = sorted((keys[i], keys[j]))
        pairs.append((round(cosine(vecs[i], vecs[j]), 4), x, y))
    pairs.sort(reverse=True)

    if a.rank:  # 임계값을 고르기 위한 진단 출력 — stdout을 오염시키지 않는다
        for s, x, y in pairs[:40]:
            print(f"{s}\t{x}\t{y}", file=sys.stderr)
        for t in (0.9, 0.88, 0.85, 0.82, 0.8, 0.75):
            print(f"  임계 {t} → 후보 {sum(1 for s, _, _ in pairs if s >= t)}건", file=sys.stderr)

    hits = [q for q in pairs if q[0] >= a.threshold]
    if a.top:
        hits = hits[: a.top]
    for s, x, y in hits:  # 계약: 한 줄 = 한 쌍
        print(f"{x}\t{y}\t{s}")


if __name__ == "__main__":
    main()
