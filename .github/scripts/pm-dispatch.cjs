const TEAM_LABELS = {
  product: ['team:product', 'Product / service planning'],
  ux: ['team:ux', 'UX / Figma'],
  engineering: ['team:engineering', 'Engineering / app development'],
  data: ['team:data', 'Data / Supabase DB'],
  'qa-security': ['team:qa-security', 'QA / Reliability / Security'],
  release: ['team:release', 'Release / operations'],
};

const ROUTING_LABELS = [
  'owner:codex', 'owner:claude',
  'state:ready', 'state:handoff',
  'handoff:codex', 'handoff:claude',
  ...Object.values(TEAM_LABELS).map(([name]) => name),
];

const DIRECTIVE = /^PM_DIRECTIVE: team=(product|ux|engineering|data|qa-security|release) to=(auto|claude|codex) action=execute pr=(none|[0-9]+) head=(none|[0-9a-f]{40})$/;
const LEGACY_DIRECTIVE = /^PM_DIRECTIVE: to=(auto|claude|codex) action=execute pr=(none|[0-9]+) head=(none|[0-9a-f]{40})$/;
const PENDING = /^<!-- onepick-pm-dispatch:pending source=comment-([0-9]+) kind=(directive|report) team=([^ ]+) to=([^ ]+) pr=(none|[0-9]+) head=(none|[0-9a-f]{40}) -->$/;

const firstLine = (body = '') => body.split(/\r?\n/, 1)[0];
const names = (issue) => (issue.labels || []).map((x) => typeof x === 'string' ? x : x.name);
const has = (issue, label) => names(issue).includes(label);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function inferTeam(issue) {
  const labels = new Set(names(issue));
  const title = issue.title || '';
  if (labels.has('area:data')) return 'data';
  if (labels.has('area:qa') || labels.has('area:security') || labels.has('security')) return 'qa-security';
  if (labels.has('area:infra')) return 'release';
  if (/Figma|UX|UI Stabilization/i.test(title)) return 'ux';
  if (/Product|서비스기획|기획|MVP 범위/i.test(title)) return 'product';
  return 'engineering';
}

function executor(team, requested) {
  if (requested !== 'auto') return requested;
  return ['qa-security', 'release'].includes(team) ? 'claude' : 'codex';
}

function parseDirective(line, issue) {
  let m = line.match(DIRECTIVE);
  if (m) {
    const [, team, requested, pr, head] = m;
    return { team, target: executor(team, requested), pr, head };
  }
  m = line.match(LEGACY_DIRECTIVE);
  if (!m) return null;
  const [, requested, pr, head] = m;
  const team = inferTeam(issue);
  return { team, target: executor(team, requested), pr, head };
}

function validPair(pr, head) {
  return (pr === 'none' && head === 'none') || (pr !== 'none' && head !== 'none');
}

module.exports = async function run({ github, context, core }) {
  const { owner, repo } = context.repo;
  const repository = `${owner}/${repo}`;
  const repositoryOwner = owner;
  const appLogin = `${process.env.APP_SLUG}[bot]`;
  const issueNumber = context.eventName === 'workflow_dispatch'
    ? Number(process.env.RETRY_ISSUE)
    : context.payload.issue.number;

  let comments = await github.paginate(github.rest.issues.listComments, {
    owner, repo, issue_number: issueNumber, per_page: 100,
  });

  const botHas = (marker) => comments.some((c) => c.user?.login === appLogin && (c.body || '').includes(marker));

  async function post(body) {
    const { data } = await github.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });
    comments.push(data);
    return data;
  }

  async function getIssue() {
    return (await github.rest.issues.get({ owner, repo, issue_number: issueNumber })).data;
  }

  async function verifyPr(pr, head) {
    if (!validPair(pr, head)) return false;
    if (pr === 'none') return true;
    try {
      const { data } = await github.rest.pulls.get({ owner, repo, pull_number: Number(pr) });
      if (data.state !== 'open' || data.base.ref !== 'main' ||
          data.head.repo?.full_name !== repository || data.head.sha !== head) return false;
      const refs = new RegExp(`(^|\\s)Refs\\s+#${issueNumber}(\\D|$)`, 'm');
      return refs.test(data.body || '');
    } catch {
      return false;
    }
  }

  async function ensureTeamLabel(team) {
    const [name, description] = TEAM_LABELS[team];
    try {
      await github.rest.issues.createLabel({ owner, repo, name, color: 'C5DEF5', description });
    } catch (error) {
      if (error.status !== 422) throw error;
    }
    return name;
  }

  async function removeLabel(label) {
    try {
      await github.rest.issues.removeLabel({ owner, repo, issue_number: issueNumber, name: label });
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }

  async function addLabels(labels) {
    await github.rest.issues.addLabels({ owner, repo, issue_number: issueNumber, labels });
  }

  async function retry(operation) {
    let last;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { return await operation(); }
      catch (error) {
        last = error;
        if (attempt < 3) await sleep(attempt * 1000);
      }
    }
    throw last;
  }

  async function processedSkip(source, reason) {
    const marker = `<!-- onepick-pm-dispatch:processed source=comment-${source} -->`;
    if (botHas(marker)) return;
    await post(`${marker}\n## PM 자동 배정 생략\n${reason}`);
  }

  if (context.eventName === 'issue_comment') {
    const source = context.payload.comment;
    const line = firstLine(source.body);
    const processed = `<!-- onepick-pm-dispatch:processed source=comment-${source.id} -->`;
    if (botHas(processed)) return;

    if (line.startsWith('PM_DIRECTIVE: ')) {
      if (source.user.login !== repositoryOwner) return;
      const issue = await getIssue();
      const parsed = parseDirective(line, issue);
      if (!parsed) return;
      if (!validPair(parsed.pr, parsed.head)) {
        await processedSkip(source.id, 'PR/head는 둘 다 지정하거나 둘 다 none이어야 합니다.');
        return;
      }
      if (!(await verifyPr(parsed.pr, parsed.head))) {
        await processedSkip(source.id, 'PR/head/Refs 검증에 실패했습니다. stale 또는 다른 작업 지시는 실행하지 않습니다.');
        return;
      }
      const pending = `<!-- onepick-pm-dispatch:pending source=comment-${source.id} kind=directive team=${parsed.team} to=${parsed.target} pr=${parsed.pr} head=${parsed.head} -->`;
      if (!botHas(pending)) await post(pending);
    } else if (line === '## 완료 리포트') {
      if (![repositoryOwner, appLogin].includes(source.user.login)) return;
      let pr = 'none', head = 'none';
      const prMatch = (source.body || '').match(/^PR: #([0-9]+)\s*$/m);
      const headMatch = (source.body || '').match(/^head: ([0-9a-f]{40})\s*$/mi);
      if (prMatch && headMatch && await verifyPr(prMatch[1], headMatch[1])) {
        pr = prMatch[1]; head = headMatch[1];
      }
      const pending = `<!-- onepick-pm-dispatch:pending source=comment-${source.id} kind=report team=none to=none pr=${pr} head=${head} -->`;
      if (!botHas(pending)) await post(pending);
    } else {
      return;
    }
  }

  comments = await github.paginate(github.rest.issues.listComments, {
    owner, repo, issue_number: issueNumber, per_page: 100,
  });

  const pendingItems = comments
    .filter((c) => c.user?.login === appLogin)
    .map((c) => ({ c, m: firstLine(c.body).match(PENDING) }))
    .filter((x) => x.m)
    .sort((a, b) => a.c.id - b.c.id);

  for (const { m } of pendingItems) {
    const [, sourceId, kind, team, target, pr, head] = m;
    const processed = `<!-- onepick-pm-dispatch:processed source=comment-${sourceId} -->`;
    if (botHas(processed)) continue;

    let issue = await getIssue();
    if (issue.state !== 'open') {
      await processedSkip(sourceId, '닫힌 작업은 자동 배정하지 않습니다.');
      continue;
    }
    if (has(issue, 'state:blocked')) continue;

    let source;
    try {
      source = (await github.rest.issues.getComment({ owner, repo, comment_id: Number(sourceId) })).data;
    } catch {
      await processedSkip(sourceId, '원본 지시/보고 댓글을 확인할 수 없습니다.');
      continue;
    }

    if (kind === 'directive') {
      if (source.user?.login !== repositoryOwner) {
        await processedSkip(sourceId, '신뢰되지 않은 지시 작성자입니다.');
        continue;
      }
      const normalized = parseDirective(firstLine(source.body), issue);
      if (!normalized || normalized.team !== team || normalized.target !== target ||
          normalized.pr !== pr || normalized.head !== head) {
        await processedSkip(sourceId, 'pending marker와 원본 지시가 일치하지 않습니다.');
        continue;
      }
      if (has(issue, 'state:active') || has(issue, 'state:review')) continue;
      if (!(await verifyPr(pr, head))) {
        await processedSkip(sourceId, '처리 시점에 PR/head/Refs가 stale입니다.');
        continue;
      }

      try {
        await retry(async () => {
          const teamLabel = await ensureTeamLabel(team);
          issue = await getIssue();
          const ownerLabel = `owner:${target}`;
          for (const label of ROUTING_LABELS) {
            if (label !== ownerLabel && label !== teamLabel && has(issue, label)) await removeLabel(label);
          }
          await addLabels([ownerLabel, teamLabel, 'state:ready']);
          const verify = await getIssue();
          if (![ownerLabel, teamLabel, 'state:ready'].every((x) => has(verify, x))) {
            throw new Error('assignment labels not confirmed');
          }
        });
      } catch (error) {
        const failMarker = `<!-- onepick-pm-dispatch:failed source=comment-${sourceId} -->`;
        if (!botHas(failMarker)) {
          await post(`${failMarker}\n## 자동 배정 확인 필요\nGitHub 상태 반영을 3회 시도했지만 확인되지 않았습니다. pending 지시는 유지합니다.\n\n오류 종류: ${error.name || 'Error'}`);
        }
        core.setFailed(`assignment failed for source ${sourceId}`);
        return;
      }

      await post([
        processed,
        `<!-- onepick-pm-assignment source=comment-${sourceId} team=${team} executor=${target} -->`,
        '## PM 자동 배정',
        `담당 조직: ${team}`,
        `실행자: ${target}`,
        '상태: state:ready',
        `원 지시: ${source.html_url}`,
      ].join('\n'));
    } else {
      if (![repositoryOwner, appLogin].includes(source.user?.login) || firstLine(source.body) !== '## 완료 리포트') {
        await processedSkip(sourceId, '신뢰되지 않았거나 형식이 변경된 완료 리포트입니다.');
        continue;
      }
      try {
        await retry(async () => {
          issue = await getIssue();
          for (const label of ['state:ready', 'state:active', 'state:handoff', 'handoff:codex', 'handoff:claude']) {
            if (has(issue, label)) await removeLabel(label);
          }
          await addLabels(['state:review']);
          if (!has(await getIssue(), 'state:review')) throw new Error('review state not confirmed');
        });
      } catch (error) {
        core.setFailed(`report routing failed for source ${sourceId}: ${error.message}`);
        return;
      }
      await post([
        `PM_REVIEW_REQUIRED: reason=stage-complete pr=${pr} head=${head}`,
        processed,
        `자동 완료 리포트 접수: ${source.html_url}`,
      ].join('\n'));
    }
  }
};

module.exports._test = { inferTeam, executor, parseDirective, validPair, firstLine };
