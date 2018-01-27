import {MsgSafeKeyboardEvent, MsgSafeNode} from './msgsafe'
import {isTextEditable} from './dom'
import {isSimpleKey} from './keyseq'
import state from "./state"
import {repeat} from './excmds_background'
import Logger from "./logging"

import {parser as exmode_parser} from './parsers/exmode'
import {parser as hintmode_parser} from './hinting_background'
import * as normalmode from "./parsers/normalmode"
import * as insertmode from "./parsers/insertmode"
import * as ignoremode from "./parsers/ignoremode"
import * as gobblemode from './parsers/gobblemode'
import * as inputmode from './parsers/inputmode'
import * as keyseq from './keyseq'
import * as config from './config'


const logger = new Logger('controller')

/** Accepts keyevents, resolves them to maps, maps to exstrs, executes exstrs */
function *ParserController () {
    const parsers = {
        normal: normalmode.parser,
        insert: insertmode.parser,
        ignore: ignoremode.parser,
        hint: hintmode_parser,
        gobble: gobblemode.parser,
        input: inputmode.parser,
    }

    // ugly pls remove
    let nmaps_newfangled = keyseq.mapstrMapToKeyMap(config.get("nmaps"))

    while (true) {
        let ex_str = ""
        let keys = []
        let keyevents = []
        try {
            while (true) { 
                let keyevent: MsgSafeKeyboardEvent = yield
                let keypress = keyevent.key

                // TODO: think about if this is robust
                if (state.mode != "ignore" && state.mode != "hint" && state.mode != "input") {
                    if (isTextEditable(keyevent.target)) {
                        state.mode = "insert"
                    } else if (state.mode === 'insert') {
                        state.mode = "normal"
                    }
                }
                logger.debug(keyevent, state.mode)

                // Special keys (e.g. Backspace) are not handled properly
                // yet. So drop them. This also drops all modifier keys.
                // When we put in handling for other special keys, remember
                // to continue to ban modifiers.
                if (state.mode === 'normal' && ! isSimpleKey(keyevent)) {
                    continue
                }

                keys.push(keypress)
                keyevents.push(keyevent)
                let response = undefined
                switch (state.mode) {
                    case 'normal':
                        response = (parsers[state.mode] as any)(keys)
                        // magic: undo the changes and it still doesn't work
                        // response = (keyseq.parse(keyevents, nmaps_newfangled))
                        break
                    default:
                        response = (parsers[state.mode] as any)([keyevent])
                        break
                }
                logger.debug(keys, response)

                if (response.ex_str){
                    ex_str = response.ex_str
                    break
                } else {
                    keys = response.keys
                }
            }
            acceptExCmd(ex_str)
        } catch (e) {
            // Rumsfeldian errors are caught here
            console.error("Tridactyl ParserController fatally wounded:", e)
        }
    }
}

let generator = ParserController() // var rather than let stops weirdness in repl.
generator.next()

/** Feed keys to the ParserController */
export function acceptKey(keyevent: MsgSafeKeyboardEvent) {
    generator.next(keyevent)
}

/** Parse and execute ExCmds */
export function acceptExCmd(ex_str: string) {
    // TODO: Errors should go to CommandLine.
    try {
        let [func, args] = exmode_parser(ex_str)
        // Stop the repeat excmd from recursing.
        if (func !== repeat)
            state.last_ex_str = ex_str
        try {
            func(...args)
        } catch (e) {
            // Errors from func are caught here (e.g. no next tab)
            console.error(e)
        }
    } catch (e) {
        // Errors from parser caught here
        console.error(e)
    }
}

import {activeTabId} from './lib/webext'
browser.webNavigation.onBeforeNavigate.addListener(async function (details) {
    if (details.frameId === 0 && details.tabId === await activeTabId()) {
        state.mode = 'normal'
    }
})
browser.tabs.onActivated.addListener(()=>state.mode = 'normal')
