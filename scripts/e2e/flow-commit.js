// Example flow: open the WIP row, stage all, type a message, commit.
// Body of an async fn run in the page (sleep/find/click/type come from scripts/capture.cjs).
await click('.wip-label')
const before = find('.changes-panel').innerText.slice(0, 120)
await click('.changes-panel .heading-actions button', 'Stage all')
await type('.commit-box textarea', 'commit from driver')
await click('.commit-actions button', 'Commit')
await sleep(1000)
return { before }
