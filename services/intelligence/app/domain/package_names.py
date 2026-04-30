from __future__ import annotations

import re


def normalize_package_name_for_similarity(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.strip().lower())


def damerau_levenshtein_distance(left: str, right: str) -> int:
    if left == right:
        return 0
    if not left:
        return len(right)
    if not right:
        return len(left)

    distances: dict[tuple[int, int], int] = {}
    len_left = len(left)
    len_right = len(right)

    for index_left in range(-1, len_left + 1):
        distances[(index_left, -1)] = index_left + 1
    for index_right in range(-1, len_right + 1):
        distances[(-1, index_right)] = index_right + 1

    for index_left in range(len_left):
        for index_right in range(len_right):
            cost = 0 if left[index_left] == right[index_right] else 1
            distances[(index_left, index_right)] = min(
                distances[(index_left - 1, index_right)] + 1,
                distances[(index_left, index_right - 1)] + 1,
                distances[(index_left - 1, index_right - 1)] + cost,
            )
            if (
                index_left > 0
                and index_right > 0
                and left[index_left] == right[index_right - 1]
                and left[index_left - 1] == right[index_right]
            ):
                distances[(index_left, index_right)] = min(
                    distances[(index_left, index_right)],
                    distances[(index_left - 2, index_right - 2)] + cost,
                )

    return distances[(len_left - 1, len_right - 1)]


def lexical_similarity_score(left: str, right: str) -> float:
    normalized_left = normalize_package_name_for_similarity(left)
    normalized_right = normalize_package_name_for_similarity(right)
    if not normalized_left and not normalized_right:
        return 1.0
    if not normalized_left or not normalized_right:
        return 0.0

    max_length = max(len(normalized_left), len(normalized_right))
    distance = damerau_levenshtein_distance(normalized_left, normalized_right)
    return max(0.0, 1.0 - (distance / max_length))


def looks_like_typo_variant(package: str, candidate: str) -> bool:
    normalized_package = normalize_package_name_for_similarity(package)
    normalized_candidate = normalize_package_name_for_similarity(candidate)
    if normalized_package == normalized_candidate:
        return False
    if not normalized_package or not normalized_candidate:
        return False
    if abs(len(normalized_package) - len(normalized_candidate)) > 2:
        return False
    if normalized_package[0] != normalized_candidate[0]:
        return False
    return lexical_similarity_score(package, candidate) >= 0.75
