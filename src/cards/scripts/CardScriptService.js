import { CardScriptCompiler } from './CardScriptCompiler.js';
import { CardScriptRuntime } from './CardScriptRuntime.js';
import { CustomHookRegistry } from './CustomHookRegistry.js';
import { EffectPrimitiveLibrary } from './EffectPrimitiveLibrary.js';
import { ScriptValidator } from './ScriptValidator.js';
import { OracleTemplateCompiler } from '../compiler/OracleTemplateCompiler.js';

export class CardScriptService {
  constructor(engine = null) {
    this.engine = engine;
    this.primitives = new EffectPrimitiveLibrary();
    this.customHooks = new CustomHookRegistry();
    this.validator = new ScriptValidator({ primitives: this.primitives, customHooks: this.customHooks });
    this.compiler = new CardScriptCompiler({ primitives: this.primitives, validator: this.validator });
    this.oracleCompiler = new OracleTemplateCompiler({ scriptCompiler: this.compiler });
    this.runtime = engine ? new CardScriptRuntime(engine, { customHooks: this.customHooks }) : null;
  }

  compileCard(card) { return this.compiler.compileCard(card); }
  compileDatabase(db) { return this.compiler.compileDatabase(db); }
  validateCard(card) { return this.validator.validateCard(card); }
  compileOracleText(card) { return this.oracleCompiler.compileCard(card); }
  analyzeOracleText(card) { return this.oracleCompiler.analyzeCard(card); }
  registerCustomHook(spec) { return this.customHooks.register(spec); }
  snapshot() {
    return {
      primitives: this.primitives.list(),
      customHooks: this.customHooks.snapshot(),
      oracleCompiler: this.oracleCompiler.capabilities()
    };
  }
}
