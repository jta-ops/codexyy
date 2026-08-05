// Mutable renderer — swap to TUI instance to redirect all AI output
import * as cli from './ui.js'

const r = {
  printBanner:     (...a) => cli.printBanner(...a),
  printHelp:       (...a) => cli.printHelp(...a),
  printUser:       (...a) => cli.printUser?.(...a),
  printAI:         (...a) => cli.printAI(...a),
  printAIStart:    (...a) => cli.printAIStart(...a),
  printAIEnd:      (...a) => cli.printAIEnd(...a),
  printToolCall:   (...a) => cli.printToolCall(...a),
  printToolResult: (...a) => cli.printToolResult(...a),
  printError:      (...a) => cli.printError(...a),
  printInfo:       (...a) => cli.printInfo(...a),
  printCost:       (...a) => cli.printCost(...a),
}

export default r

export function setRenderer(tui) {
  for (const key of Object.keys(r)) {
    if (typeof tui[key] === 'function') r[key] = (...a) => tui[key](...a)
  }
}
