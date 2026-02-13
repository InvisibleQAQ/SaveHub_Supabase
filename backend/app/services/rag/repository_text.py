"""Repository 文本拼接工具。"""

from typing import Any, Dict


def build_repository_embedding_text(repo: Dict[str, Any]) -> str:
    """按固定模板拼接 repository 的 embedding/full-text。"""
    parts = []
    parts.append(f"仓库名称: {repo.get('full_name', '')}")

    if repo.get("description"):
        parts.append(f"描述: {repo['description']}")
    if repo.get("html_url"):
        parts.append(f"链接: {repo['html_url']}")
    if repo.get("owner_login"):
        parts.append(f"所有者: {repo['owner_login']}")

    topics = repo.get("topics") or []
    if topics:
        parts.append(f"标签: {', '.join(topics)}")

    ai_tags = repo.get("ai_tags") or []
    if ai_tags:
        parts.append(f"AI标签: {', '.join(ai_tags)}")

    if repo.get("language"):
        parts.append(f"主要语言: {repo['language']}")

    if repo.get("readme_content"):
        parts.append(f"\nREADME内容:\n{repo['readme_content']}")

    if repo.get("ai_summary"):
        parts.append(f"\nAI摘要:\n{repo['ai_summary']}")

    return "\n".join(parts)

