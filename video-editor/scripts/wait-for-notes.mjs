// Waits until the review for the current draft is sent from the dashboard, then prints the notes.
// Claude runs this in the background after showing a draft, so "Send notes" starts the next draft.
//   node scripts/wait-for-notes.mjs [project]
import path from 'node:path';
import { pickProject, projectDir, readJSON, reviewFile } from './lib.mjs';

const slug = pickProject(process.argv[2]);
const sb = () => readJSON(path.join(projectDir(slug), 'storyboard.json'));
const draft = sb().draft;
const deadline = Date.now() + Number(process.env.WAIT_MINUTES || 110) * 60000;

for (;;) {
  const r = readJSON(reviewFile(slug, draft), null);
  if (r?.submittedAt) {
    const beats = sb().beats;
    const changes = beats.filter((b) => r.beats?.[b.id]?.status === 'changes');
    const pending = beats.filter((b) => !['approved', 'changes'].includes(r.beats?.[b.id]?.status));
    console.log(`Review of "${slug}" draft ${draft} sent ${r.submittedAt}`);
    console.log(`${beats.length - changes.length - pending.length} approved, ${changes.length} change request(s), ${pending.length} not reviewed`);
    for (const b of changes) console.log(`\n[${b.id}] ${b.label}\n  NOTE: ${r.beats[b.id].note || '(no note written)'}`);
    if (pending.length) console.log(`\nNot reviewed: ${pending.map((b) => b.label).join(', ')}`);
    console.log(r.exportRequested ? '\nEXPORT REQUESTED: run  npm run export -- ' + slug : '\nNEXT: apply the notes in storyboard.json, then  npm run draft -- ' + slug);
    process.exit(0);
  }
  if (Date.now() > deadline) { console.log('No review sent yet.'); process.exit(3); }
  await new Promise((res) => setTimeout(res, 2000));
}
