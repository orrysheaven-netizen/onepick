#!/usr/bin/env python3
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import pm_assignment as m


class ParseTests(unittest.TestCase):
    def test_valid_auto_routes_by_team(self):
        d = m.parse_directive("PM_DIRECTIVE: team=qa to=auto action=execute pr=none head=none\ntext")
        self.assertEqual((d.team, d.owner), ("qa", "claude"))
        d = m.parse_directive("PM_DIRECTIVE: team=data to=auto action=execute pr=none head=none")
        self.assertEqual(d.owner, "codex")

    def test_explicit_owner_overrides_default(self):
        d = m.parse_directive("PM_DIRECTIVE: team=engineering to=claude action=execute pr=none head=none")
        self.assertEqual(d.owner, "claude")

    def test_only_first_line_and_exact_shape(self):
        self.assertIsNone(m.parse_directive("note\nPM_DIRECTIVE: team=qa to=auto action=execute pr=none head=none"))
        self.assertIsNone(m.parse_directive("PM_DIRECTIVE: team=qa to=auto action=execute pr=12 head=none"))
        self.assertIsNone(m.parse_directive("PM_DIRECTIVE: team=madeup to=auto action=execute pr=none head=none"))

    def test_report_requires_first_line(self):
        self.assertTrue(m.is_completion_report("## 완료 리포트\n결과: ok"))
        self.assertFalse(m.is_completion_report("text\n## 완료 리포트"))

    def test_report_pr_is_unambiguous(self):
        self.assertEqual(m.extract_report_pr("## 완료 리포트\nPR: #12\n"), "12")
        self.assertEqual(m.extract_report_pr("## 완료 리포트\nPR: #12\nPR: #13\n"), "none")

    def test_assignment_states(self):
        self.assertEqual(m.assignment_state(["state:blocked"]), "blocked")
        self.assertEqual(m.assignment_state(["state:active"]), "active")
        self.assertEqual(m.assignment_state(["state:review"]), "review")
        self.assertEqual(m.assignment_state(["owner:codex"]), "assignable")

    def test_label_plan_removes_old_owner_team_handoff(self):
        got = m.desired_assignment_labels(
            ["owner:codex", "team:product", "state:handoff", "handoff:claude", "size:M", "area:app"],
            "qa", "claude",
        )
        self.assertIn("owner:claude", got)
        self.assertIn("team:qa", got)
        self.assertIn("state:ready", got)
        self.assertIn("size:M", got)
        self.assertNotIn("owner:codex", got)
        self.assertNotIn("handoff:claude", got)
        self.assertNotIn("state:handoff", got)


class FakeGitHub:
    def __init__(self, labels=None, pr=None):
        self.repository = "orrysheaven-netizen/onepick"
        self._issue = {"state": "open", "labels": [{"name": x} for x in (labels or [])]}
        self._comments = []
        self._pr = pr or {
            "state": "open",
            "base": {"ref": "main"},
            "head": {"repo": {"full_name": self.repository}, "sha": "a" * 40},
            "body": "Refs #10",
        }

    def issue(self, issue):
        return {"state": self._issue["state"], "labels": [dict(x) for x in self._issue["labels"]]}

    def pr(self, pr):
        return self._pr

    def comments(self, issue):
        return [dict(x) for x in self._comments]

    def comment(self, issue, body):
        self._comments.append({"id": len(self._comments) + 1000, "body": body, "user": {"login": "pm-bot[bot]"}})

    def ensure_team_label(self, team):
        pass

    def replace_labels(self, issue, current, desired):
        self._issue["labels"] = [{"name": x} for x in desired]


class FlowTests(unittest.TestCase):
    def test_directive_assigns_team_owner_ready(self):
        gh = FakeGitHub(labels=["size:M", "owner:codex"])
        body = "PM_DIRECTIVE: team=qa to=auto action=execute pr=none head=none"
        self.assertTrue(m.enqueue_directive(gh, 10, "55", "owner", "owner", body, "pm-bot[bot]", "u"))
        self.assertEqual(m.drain_directives(gh, 10, "pm-bot[bot]"), 1)
        labels = {x["name"] for x in gh.issue(10)["labels"]}
        self.assertTrue({"team:qa", "owner:claude", "state:ready"}.issubset(labels))
        self.assertNotIn("owner:codex", labels)

    def test_blocked_keeps_pending_until_unblocked(self):
        gh = FakeGitHub(labels=["state:blocked", "size:S"])
        body = "PM_DIRECTIVE: team=engineering to=auto action=execute pr=none head=none"
        m.enqueue_directive(gh, 10, "56", "owner", "owner", body, "pm-bot[bot]", "u")
        self.assertEqual(m.drain_directives(gh, 10, "pm-bot[bot]"), 0)
        self.assertTrue(any("onepick-pm-dispatch:pending" in x["body"] for x in gh.comments(10)))
        gh._issue["labels"] = [{"name": "size:S"}]
        self.assertEqual(m.drain_directives(gh, 10, "pm-bot[bot]"), 1)

    def test_active_or_review_does_not_reassign(self):
        for state in ("state:active", "state:review"):
            gh = FakeGitHub(labels=[state])
            body = "PM_DIRECTIVE: team=product to=auto action=execute pr=none head=none"
            m.enqueue_directive(gh, 10, "57", "owner", "owner", body, "pm-bot[bot]", "u")
            self.assertEqual(m.drain_directives(gh, 10, "pm-bot[bot]"), 0)
            self.assertIn(state, {x["name"] for x in gh.issue(10)["labels"]})

    def test_untrusted_directive_is_not_enqueued(self):
        gh = FakeGitHub()
        body = "PM_DIRECTIVE: team=qa to=auto action=execute pr=none head=none"
        self.assertFalse(m.enqueue_directive(gh, 10, "58", "someone", "owner", body, "pm-bot[bot]", "u"))
        self.assertEqual(gh.comments(10), [])

    def test_stale_pr_head_is_rejected(self):
        gh = FakeGitHub()
        body = "PM_DIRECTIVE: team=engineering to=auto action=execute pr=12 head=" + ("b" * 40)
        self.assertFalse(m.enqueue_directive(gh, 10, "59", "owner", "owner", body, "pm-bot[bot]", "u"))

    def test_completion_report_routes_to_pm_review_and_review_state(self):
        gh = FakeGitHub(labels=["team:engineering", "owner:codex", "state:active"])
        body = "## 완료 리포트\n담당: Codex\n결과: ok\nPR: #12\n"
        self.assertTrue(m.enqueue_report(gh, 10, "60", "owner", "owner", body, "pm-bot[bot]"))
        self.assertEqual(m.drain_reports(gh, 10, "pm-bot[bot]"), 1)
        labels = {x["name"] for x in gh.issue(10)["labels"]}
        self.assertIn("state:review", labels)
        self.assertNotIn("state:active", labels)
        self.assertTrue(any(x["body"].startswith("PM_REVIEW_REQUIRED: reason=stage-complete pr=12 head=" + "a"*40)
                            for x in gh.comments(10)))

    def test_blocked_completion_report_stays_pending(self):
        gh = FakeGitHub(labels=["state:blocked", "owner:claude"])
        body = "## 완료 리포트\n결과: waiting\n"
        m.enqueue_report(gh, 10, "61", "owner", "owner", body, "pm-bot[bot]")
        self.assertEqual(m.drain_reports(gh, 10, "pm-bot[bot]"), 0)
        self.assertFalse(any(x["body"].startswith("PM_REVIEW_REQUIRED:") for x in gh.comments(10)))


if __name__ == "__main__":
    unittest.main()
