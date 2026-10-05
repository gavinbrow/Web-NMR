const output = document.getElementById('output')!
const button = document.getElementById('run') as HTMLButtonElement
button.onclick = () => {
  button.disabled = true
  output.textContent = 'Loading local learned coupling model and WASM assets…'
  const worker = new Worker(new URL('./browser-validation.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event) => {
    if (event.data.progress) output.textContent = event.data.progress
    else { output.textContent = JSON.stringify(event.data, null, 2); button.disabled = false; worker.terminate() }
  }
  worker.onerror = (event) => { output.textContent = `FAIL: ${event.message}`; button.disabled = false; worker.terminate() }
  worker.postMessage('run')
}
