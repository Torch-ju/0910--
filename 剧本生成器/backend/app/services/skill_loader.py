import hashlib

from app.config import ROOT


def story_skill(full=False):
    """Only this locally bundled skill can be loaded; no model-supplied file paths."""
    path = ROOT / "jin-yong-perspective" / "SKILL.md"
    content = path.read_text()
    # Use the six models and heuristics as writing guidance, not impersonation instructions.
    relevant = [
        line
        for line in content.splitlines()
        if line.startswith(("**核心理念**", "**原则**", "### 新武侠小说构思五步"))
    ]
    if full:
        start = content.index("## 核心心智模型")
        end = content.index("## 调研来源说明")
        relevant = [content[start:end]]
    return {
        "name": "jin-yong-perspective",
        "hash": hashlib.sha256(content.encode()).hexdigest(),
        "instructions": "\n".join(relevant),
        "source": "jin-yong-perspective/SKILL.md",
    }
