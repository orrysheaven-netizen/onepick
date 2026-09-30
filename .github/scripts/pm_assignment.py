#!/usr/bin/env python3
"""GitHub-only PM assignment/report dispatcher for OnePick.

This module never invokes an AI model. It only validates trusted PM directives,
stores durable markers on the original issue, assigns team/owner labels, and
returns completion reports to the existing PM review queue.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from dataclasses import dataclass
from typing import Iterable

TEAMS = ("product", "ux", "engineering", "data", "qa", "release")
TEAM_DEFAULT_OWNER = {
    "product": "codex",
    "ux": "codex",
    "engineering": "codex",
    "data": "codex",
    "qa": "claude",
    "release": "claude",
}
TEAM_LABELS = {team: f"team:{team}" for team in TEAMS}
TEAM_COLORS = {
    "product": "A2EEEF",
    "ux": "D4C5F9",
    "engineering": "C5DEF5",
    "data": "BFE5BF",
    "qa": "F9D0C4",
    "release": "0052CC",
}
DIRECTIVE_RE = re.compile(
    r"PM_DIRECTIVE: team=(product|ux|engineering|data|qa|release) "
    r"to=(auto|codex|claude) action=execute "
    r"pr=(none|[0-9]{1,7}) head=(none|[0-9a-f]{40})"
)
REPORT_PR_RE = re.compile(r"(?m)^PR:\s*#([0-9]{1,7})\s*$")
PENDING_DIRECTIVE_RE = re.compile(
    r"<!-- onepick-pm-dispatch:pending source=comment-(?P<sid>[0-9]+) "
    r"team=(?P<team>[a-z]+) owner=(?P<owner>codex|claude) "
    r"pr=(?P<pr>none|[0-9]+) head=(?P<head>none|[0-9a-f]{40}) -->"
)
PENDING_REPORT_RE = re.compile(
    r"<!-- onepick-pm-report:pending source=comment-(?P<sid>[0-9]+) "
    r"pr=(?P<pr>none|[0-9]+) head=(?P<head>none|[0-9a-f]{40}) -->"
)


@dataclass(frozen=True)
class Directive:
    team: str
    requested_owner: str
    owner: str
    pr: str
    head: str


def first_line(body: str) -> str:
    return body.splitlines()[0].rstrip("\r") if body else ""


def parse_directive(body: str) -> Directive | None:
    match = DIRECTIVE_RE.fullmatch(first_line(body))
    if not match:
        return None
    team, requested, pr, head = match.groups()
    if (pr == "none") != (head == "none"):
        return None
    owner = TEAM_DEFAULT_OWNER[team] if requested == "auto" else requested
    return Directive(team, requested, owner, pr, head)


def is_completion_report(body: str) -> bool:
    return first_line(body) == "## 완료 리포트"


def extract_report_pr(body: str) -> str:
    matches = sorted(set(REPORT_PR_RE.findall(body)))
    return matches[0] if len(matches) == 1 else "none"


def assignment_state(labels: Iterable[str]) -> str:
    values = set(labels)
    if "state:blocked" in values:
        return "blocked"
    if "state:active" in values:
        return "active"
    if "state:review" in values:
        return "review"
    return "assignable"


def desired_assignment_labels(labels: Iterable[str], team: str, owner: str) -> list[str]:
    result = [
        label for label in labels
        if not (
            label.startswith("owner:")
            or label.startswith("team:")
            or label.startswith("handoff:")
            or label in {"state:handoff", "state:ready"}
        )
    ]
    result += [TEAM_LABELS[team], f"owner:{owner}", "state:ready"]
    return sorted(set(result))


class GitHub:
    def __init__(self, repository: str):
        self.repository = repository

    def _run(self, args: list[str]) -> str:
        completed = subprocess.run(
            ["gh", *args], text=True, check=True, capture_output=True
        )
        return completed.stdout

    def api_json(self, endpoint: str) -> dict | list:
        return json.loads(self._run(["api", endpoint]))

    def issue(self, issue: int) -> dict:
        return self.api_json(f"repos/{self.repository}/issues/{issue}")

    def pr(self, pr: int) -> dict:
        return self.api_json(f"repos/{self.repository}/pulls/{pr}")

    def comments(self, issue: int) -> list[dict]:
        raw = self._run(["api", "--paginate", f"repos/{self.repository}/issues/{issue}/comments?per_page=100"])
        decoder = json.JSONDecoder()
        pos, values = 0, []
        while pos < len(raw):
            while pos < len(raw) and raw[pos].isspace():
                pos += 1
            if pos >= len(raw):
                break
            page, pos = decoder.raw_decode(raw, pos)
            values.extend(page)
        return values

    def comment(self, issue: int, body: str) -> None:
        self._run(["issue", "comment", str(issue), "--repo", self.repository, "--body", body])

    def ensure_team_label(self, team: str) -> None:
        self._run([
            "label", "create", TEAM_LABELS[team], "--repo", self.repository,
            "--color", TEAM_COLORS[team],
            "--description", f"PM team assignment: {team}",
            "--force",
        ])

    def replace_labels(self, issue: int, current: Iterable[str], desired: Iterable[str]) -> None:
        old, new = set(current), set(desired)
        for label in sorted(old - new):
            self._run(["issue", "edit", str(issue), "--repo", self.repository, "--remove-label", label])
        for label in sorted(new - old):
            self._run(["issue", "edit", str(issue), "--repo", self.repository, "--add-label", label])


def comment_bodies(comments: list[dict], bot_login: str) -> list[str]:
    return [c.get("body", "") for c in comments if c.get("user", {}).get("login") == bot_login]


def has_marker(comments: list[dict], bot_login: str, needle: str) -> bool:
    return any(needle in body for body in comment_bodies(comments, bot_login))


def validate_pr(gh: GitHub, issue: int, pr: str, head: str) -> tuple[bool, str]:
    if pr == "none":
        return (head == "none", "pr/head pair")
    data = gh.pr(int(pr))
    same_repo = (data.get("head", {}).get("repo") or {}).get("full_name") == gh.repository
    refs = re.search(rf"Refs #{issue}(?:[^0-9]|$)", data.get("body") or "") is not None
    ok = (
        data.get("state") == "open"
        and data.get("base", {}).get("ref") == "main"
        and same_repo
        and refs
        and data.get("head", {}).get("sha") == head
    )
    return ok, "open same-repo main PR, Refs issue, current head"


def report_pr_head(gh: GitHub, issue: int, body: str) -> tuple[str, str]:
    pr = extract_report_pr(body)
    if pr == "none":
        return "none", "none"
    data = gh.pr(int(pr))
    same_repo = (data.get("head", {}).get("repo") or {}).get("full_name") == gh.repository
    refs = re.search(rf"Refs #{issue}(?:[^0-9]|$)", data.get("body") or "") is not None
    if data.get("base", {}).get("ref") != "main" or not same_repo or not refs:
        return "none", "none"
    return pr, data.get("head", {}).get("sha") or "none"


def enqueue_directive(gh: GitHub, issue_no: int, source_id: str, author: str, owner_login: str, body: str, bot_login: str, source_url: str) -> bool:
    if author != owner_login:
        return False
    directive = parse_directive(body)
    if directive is None:
        return False
    issue = gh.issue(issue_no)
    if issue.get("state") != "open":
        return False
    ok, _ = validate_pr(gh, issue_no, directive.pr, directive.head)
    if not ok:
        return False
    comments = gh.comments(issue_no)
    source = f"comment-{source_id}"
    if has_marker(comments, bot_login, f"onepick-pm-dispatch:pending source={source} ") or has_marker(comments, bot_login, f"onepick-pm-dispatch:processed source={source}"):
        return True
    gh.ensure_team_label(directive.team)
    gh.comment(issue_no, (
        f"<!-- onepick-pm-dispatch:pending source={source} team={directive.team} "
        f"owner={directive.owner} pr={directive.pr} head={directive.head} -->\n"
        f"PM 업무 배정 접수 — team:{directive.team} / owner:{directive.owner}. "
        f"근거: {source_url}"
    ))
    return True


def drain_directives(gh: GitHub, issue_no: int, bot_login: str) -> int:
    issue = gh.issue(issue_no)
    if issue.get("state") != "open":
        return 0
    comments = gh.comments(issue_no)
    bodies = comment_bodies(comments, bot_login)
    processed = "\n".join(bodies)
    assigned = 0
    for comment in comments:
        if comment.get("user", {}).get("login") != bot_login:
            continue
        match = PENDING_DIRECTIVE_RE.search(comment.get("body", ""))
        if not match:
            continue
        data = match.groupdict()
        source = f"comment-{data['sid']}"
        if f"onepick-pm-dispatch:processed source={source}" in processed:
            continue
        current = gh.issue(issue_no)
        labels = [x["name"] for x in current.get("labels", [])]
        if assignment_state(labels) != "assignable":
            continue
        ok, reason = validate_pr(gh, issue_no, data["pr"], data["head"])
        if not ok:
            gh.comment(issue_no, (
                f"<!-- onepick-pm-dispatch:processed source={source} -->\n"
                f"PM 업무 배정 생략 — {reason} 검증 실패."
            ))
            processed += f"\nonepick-pm-dispatch:processed source={source}"
            continue
        gh.ensure_team_label(data["team"])
        desired = desired_assignment_labels(labels, data["team"], data["owner"])
        gh.replace_labels(issue_no, labels, desired)
        verify = [x["name"] for x in gh.issue(issue_no).get("labels", [])]
        required = {TEAM_LABELS[data["team"]], f"owner:{data['owner']}", "state:ready"}
        if not required.issubset(set(verify)):
            raise RuntimeError(f"assignment labels not applied for issue #{issue_no}")
        gh.comment(issue_no, (
            f"<!-- onepick-pm-dispatch:assigned source={source} -->\n"
            f"<!-- onepick-pm-dispatch:processed source={source} -->\n"
            f"## PM 업무 자동 배정\n"
            f"팀: `{data['team']}` · 실행자: `{data['owner']}` · 상태: `state:ready`\n\n"
            "담당 팀장/실행 세션은 #296과 자신의 `team:*` / `owner:*` `state:ready` 큐에서 이 작업을 확인합니다. "
            "이 배정은 AI 모델 자동 호출이나 main 병합 승인을 뜻하지 않습니다."
        ))
        processed += f"\nonepick-pm-dispatch:processed source={source}"
        assigned += 1
    return assigned


def enqueue_report(gh: GitHub, issue_no: int, source_id: str, author: str, owner_login: str, body: str, bot_login: str) -> bool:
    if author != owner_login or not is_completion_report(body):
        return False
    issue = gh.issue(issue_no)
    if issue.get("state") != "open":
        return False
    comments = gh.comments(issue_no)
    source = f"comment-{source_id}"
    if has_marker(comments, bot_login, f"onepick-pm-report:pending source={source} ") or has_marker(comments, bot_login, f"onepick-pm-report:processed source={source}"):
        return True
    pr, head = report_pr_head(gh, issue_no, body)
    gh.comment(issue_no, f"<!-- onepick-pm-report:pending source={source} pr={pr} head={head} -->\n완료 리포트 PM 전달 접수.")
    return True


def drain_reports(gh: GitHub, issue_no: int, bot_login: str) -> int:
    issue = gh.issue(issue_no)
    if issue.get("state") != "open":
        return 0
    comments = gh.comments(issue_no)
    bodies = comment_bodies(comments, bot_login)
    processed = "\n".join(bodies)
    sent = 0
    for comment in comments:
        if comment.get("user", {}).get("login") != bot_login:
            continue
        match = PENDING_REPORT_RE.search(comment.get("body", ""))
        if not match:
            continue
        data = match.groupdict()
        source = f"comment-{data['sid']}"
        if f"onepick-pm-report:processed source={source}" in processed:
            continue
        current = gh.issue(issue_no)
        labels = [x["name"] for x in current.get("labels", [])]
        if "state:blocked" in labels:
            continue
        desired = [
            x for x in labels
            if x not in {"state:ready", "state:active", "state:handoff"}
            and not x.startswith("handoff:")
        ]
        desired.append("state:review")
        gh.replace_labels(issue_no, labels, sorted(set(desired)))
        gh.comment(issue_no, (
            f"PM_REVIEW_REQUIRED: reason=stage-complete pr={data['pr']} head={data['head']}\n"
            f"<!-- onepick-pm-report:processed source={source} -->\n"
            f"완료 리포트 `{source}`를 PM 검토 큐로 전달합니다."
        ))
        processed += f"\nonepick-pm-report:processed source={source}"
        sent += 1
    return sent


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("enqueue-directive", "drain", "enqueue-report"))
    parser.add_argument("--issue", type=int, required=True)
    parser.add_argument("--source-id", default="")
    parser.add_argument("--author", default="")
    parser.add_argument("--body", default="")
    parser.add_argument("--source-url", default="")
    args = parser.parse_args()

    repository = os.environ["REPOSITORY"]
    repository_owner = os.environ["REPOSITORY_OWNER"]
    bot_login = os.environ["BOT_LOGIN"]
    gh = GitHub(repository)

    if args.mode == "enqueue-directive":
        if enqueue_directive(gh, args.issue, args.source_id, args.author, repository_owner, args.body, bot_login, args.source_url):
            print("enqueued=true")
        return 0
    if args.mode == "enqueue-report":
        if enqueue_report(gh, args.issue, args.source_id, args.author, repository_owner, args.body, bot_login):
            print("enqueued=true")
        return 0

    drain_directives(gh, args.issue, bot_login)
    drain_reports(gh, args.issue, bot_login)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
