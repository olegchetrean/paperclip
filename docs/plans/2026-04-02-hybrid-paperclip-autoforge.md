# Plan: Hybrid Paperclip + Autoforge — Orchestrator + Motor de Executie

**Data**: 2026-04-02
**Autor**: Oleg + Claude Opus 4.6
**Status**: PLANIFICAT

---

## Context

### Ce avem

| Proiect | Path | Rol |
|---------|------|-----|
| **Paperclip** | `~/Projects/paperclip` | Orchestrator multi-agent, governance, costuri, UI management |
| **Autoforge** | `~/Projects/autoforge-custom` | Motor autonom de coding, paralelism real, feature tracking, testing |
| **Cronberry.ai** | `~/Telegram Istoric` | Proiect target (SaaS, 57 pagini, 62 rute, 105 servicii) |

### Fork Paperclip (traducere RO completa)

- **Repo**: https://github.com/olegchetrean/paperclip
- **Branch**: `ro-translation` (3 commituri, 65+ fisiere traduse)
- **Remote `origin`**: fork-ul nostru
- **Remote `upstream`**: paperclipai/paperclip (originalul)
- **Sync cu upstream**: `git fetch upstream && git rebase upstream/master && git push --force-with-lease`

### Companie Paperclip activa

- **Companie**: Cronberry.ai (ID: `38f9165f-2e40-4c54-8765-54362a1b3a10`, prefix: CRO)
- **Agent**: Auditor (ID: `ffab7c74-7768-40b0-b869-1f5f8c50f558`)
- **Proiect**: Audit Complet Cronberry.ai
- **Taskuri**: CRO-1 la CRO-10 (8/10 done, au rapoarte detaliate in documente)

---

## Problema actuala

1. **Paperclip nu face paralelism real** — maxConcurrentRuns=8 dar tot 1 agent = 1 Claude CLI = secvential
2. **Autoforge face paralelism** (5 agenti concurenti) dar nu are governance/costuri/UI management
3. **Costurile nu se trackeaza** — Claude CLI subscription nu raporteaza usage la Paperclip
4. **Azure API nu se activeaza** — CLI prioritizeaza sesiunea de login peste env vars

---

## Arhitectura Hybrid Propusa

```
┌─────────────────────────────────────────────────┐
│              PAPERCLIP (orchestrator)            │
│  - Companii, agenți, taskuri, aprobări, costuri  │
│  - UI dashboard (tradus RO)                      │
│  - http://localhost:3100                          │
├─────────────────────────────────────────────────┤
│                                                   │
│  ┌──────────────┐  ┌──────────────┐              │
│  │ Agent CEO    │  │ Agent DevOps │              │
│  │ claude_local │  │ claude_local │              │
│  └──────┬───────┘  └──────────────┘              │
│         │                                         │
│         │ delega taskuri de coding                │
│         ▼                                         │
│  ┌──────────────────────────────────┐            │
│  │ Agent Coder (NOU)               │            │
│  │ adapter: autoforge_local        │            │
│  │                                  │            │
│  │ Primeste task → creeaza feature  │            │
│  │ → ruleaza Autoforge cu parallel  │            │
│  │ → raporteaza rezultat inapoi    │            │
│  └──────────────────────────────────┘            │
│                                                   │
│  ┌──────────────────────────────────┐            │
│  │        AUTOFORGE (motor)         │            │
│  │  - 5 agenti paraleli            │            │
│  │  - Feature dependency graph      │            │
│  │  - Playwright browser testing    │            │
│  │  - MCP feature server           │            │
│  │  - Batch mode (3 feat/sesiune)  │            │
│  │  http://localhost:4200           │            │
│  └──────────────────────────────────┘            │
└─────────────────────────────────────────────────┘
```

---

## Faze de implementare

### Faza 1: Fix Azure API + Cost Tracking (1-2 ore)

**Problema**: Claude CLI ignora ANTHROPIC_API_KEY din env cand are sesiune de login activa.

**Solutie**:
```bash
# Optiunea A: Forteaza API key in Claude CLI
claude config set --global apiKey "7EesHWLO..."

# Optiunea B: Logout din subscription, forteaza API mode
claude logout
# Apoi Claude CLI va folosi ANTHROPIC_API_KEY din env

# Optiunea C: Foloseste --api-key flag direct
# In Paperclip adapter config, seteaza extraArgs: ["--api-key", "$ANTHROPIC_API_KEY"]
```

**Verificare**: Dupa fix, costurile trebuie sa apara in Paperclip > Costuri > Per agent.

**Azure API details**:
- Endpoint: `https://mega-ai-services.services.ai.azure.com/anthropic/v1`
- API Key: `$AZURE_API_KEY (vezi Azure Portal sau az cognitiveservices account keys list)`
- Model: `claude-opus-4-6`

### Faza 2: Adapter Autoforge pentru Paperclip (4-6 ore)

Creez un adapter nou in `packages/adapters/autoforge-local/`:

```
packages/adapters/autoforge-local/
  src/
    index.ts          # type="autoforge_local", label="Autoforge"
    server/
      execute.ts      # Logica: task → feature → autoforge run → rezultat
      parse.ts        # Parseaza output-ul Autoforge
      test.ts         # Verifica ca autoforge e instalat
    ui/
      parse-stdout.ts # Transcript entries din Autoforge logs
      build-config.ts # Form pentru config
```

**Config adapter**:
```json
{
  "adapterType": "autoforge_local",
  "adapterConfig": {
    "projectDir": "/Users/macbook_nou/Telegram Istoric",
    "autoforgeDir": "/Users/macbook_nou/Projects/autoforge-custom",
    "maxConcurrency": 3,
    "batchSize": 3,
    "yolo": false,
    "model": "claude-opus-4-6",
    "env": {
      "ANTHROPIC_API_KEY": "...",
      "ANTHROPIC_BASE_URL": "..."
    }
  }
}
```

**Flow execute.ts**:
1. Primeste task de la Paperclip (titlu + descriere)
2. Creaza feature in Autoforge `features.db` via API sau direct SQLite
3. Ruleaza `python autonomous_agent_demo.py --project-dir X --parallel --max-concurrency 3`
4. Monitoreaza progresul via Autoforge WebSocket
5. Cand feature e done, returneaza rezultatul + cost la Paperclip

### Faza 3: Multi-Agent Real (2-3 ore)

Creez agenti specializati in Paperclip:

| Agent | Adapter | Rol |
|-------|---------|-----|
| **CEO** | claude_local | Strategia, delegare, coordonare |
| **Frontend Dev** | autoforge_local | Coding React pagini, componente |
| **Backend Dev** | autoforge_local | Coding Express rute, servicii |
| **QA** | claude_local | Review cod, testing, raportare bugs |
| **DevOps** | claude_local | Deploy, infra, monitoring |

Fiecare agent lucreaza pe directorul lui (`cwd`) si are specialitate.

### Faza 4: Autoforge UI Enhancements → Paperclip (optional, 4+ ore)

Importam din Autoforge in Paperclip:
- **Dependency graph vizual** (dagre) → pagina Issues sau Projects
- **Live terminal** (xterm.js) → run detail page
- **Mascot animations** (Spark, Fizz, Octo) → agent cards pe dashboard
- **Confetti on completion** → cand un task e marcat done
- **Feature MCP server pattern** → pentru atomic claim de taskuri

---

## Comparatie detaliata pentru referinta

| Aspect | Paperclip | Autoforge | Hybrid |
|--------|-----------|-----------|--------|
| Orchestrare | Multi-agent, org chart | Single project | Paperclip |
| Paralelism | Fals (1 CLI) | Real (5 procese) | Autoforge |
| Cost tracking | Da | Nu | Paperclip |
| Governance | Aprobari, bugete | Nu | Paperclip |
| Feature deps | Nu | Graph + cycle detect | Autoforge |
| Browser test | Nu | Playwright | Autoforge |
| UI feedback | Minimal | Rich (mascots, confetti) | Combinat |
| Batch mode | Nu | 1-3 feat/sesiune | Autoforge |
| Session resume | Heartbeat | features.db | Ambele |
| Scheduling | Heartbeat + cron | APScheduler | Paperclip |
| Multi-company | Da | Nu | Paperclip |
| MCP tools | Skills injection | Feature MCP server | Ambele |
| API providers | Claude local/Codex/etc | Claude + Vertex + Ollama | Extins |

---

## Andrey Karpathy — Self-Learning Integration

**De cautat**: proiectul open-source al lui Karpathy legat de auto-invatare/self-play.
Posibile referinte:
- `nanoGPT` — training from scratch
- `llm.c` — LLM training in pure C
- `minbpe` — tokenizer
- `eureka` — reward design for RL (dar e de la NVIDIA, nu Karpathy)
- `self-play` / `RLHF` patterns

**Ideea**: un loop in care agentii invata din rezultatele propriilor audituri/codari, isi imbunatatesc prompt-urile, si devin mai buni la fiecare run. Se poate implementa ca:
1. La fiecare run completed, extrage "lectii invatate"
2. Salveaza in memory (para-memory-files skill)
3. La urmatorul heartbeat, injecteaza lectiile in prompt
4. Metrica de imbunatatire: rata de success, bugs gasite, cod respins de QA

**Actiune**: cauta pe GitHub proiectele lui Karpathy + "self-improving agents" open source.

---

## Comenzi rapide

```bash
# Paperclip
cd ~/Projects/paperclip && pnpm dev          # Porneste serverul (port 3100)
curl http://localhost:3100/api/health         # Health check

# Autoforge
cd ~/Projects/autoforge-custom && ./start_ui.sh   # Porneste UI (port 4200)
python autonomous_agent_demo.py --project-dir ~/Telegram\ Istoric --parallel --max-concurrency 3

# Sync fork cu upstream
cd ~/Projects/paperclip
git fetch upstream
git rebase upstream/master
git push --force-with-lease

# Cronberry audit results
curl -s http://localhost:3100/api/issues/{issueId}/comments
curl -s http://localhost:3100/api/issues/{issueId}/documents/plan
```

---

## Prioritati

1. **URGENT**: Fix Azure API (Faza 1) — fara asta nu ai cost tracking
2. **IMPORTANT**: Adapter autoforge_local (Faza 2) — adevaratul paralelism
3. **NICE TO HAVE**: Multi-agent (Faza 3) + UI enhancements (Faza 4)
4. **RESEARCH**: Karpathy self-learning loop

---

## Fisiere cheie

| Fisier | Ce contine |
|--------|-----------|
| `~/Projects/paperclip/.env` | Azure API key (configurat dar nefolosit de CLI) |
| `~/Projects/paperclip/packages/adapters/` | Adaptoarele existente (claude_local, codex_local, etc.) |
| `~/Projects/paperclip/packages/adapters/claude-local/src/server/execute.ts` | Cum ruleaza Claude CLI — de studiat pentru noul adapter |
| `~/Projects/autoforge-custom/autonomous_agent_demo.py` | Entry point Autoforge — de integrat |
| `~/Projects/autoforge-custom/parallel_orchestrator.py` | Paralelism real — de refolosit |
| `~/Projects/autoforge-custom/mcp_server/feature_mcp.py` | MCP feature server — model de urmat |
| `~/Telegram Istoric/` | Cronberry.ai — proiectul target |
