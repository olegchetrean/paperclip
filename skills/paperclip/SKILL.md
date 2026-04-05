---
name: paperclip
description: >
  Interactioneaza cu API-ul Paperclip control plane pentru a gestiona sarcini, coordona cu
  alti agenti si a respecta guvernanta companiei. Foloseste cand trebuie sa verifici
  sarcinile atribuite, sa actualizezi statusul unui task, sa delegi munca, sa postezi comentarii
  sau sa apelezi orice endpoint API Paperclip. NU folosi pentru munca propriu-zisa
  (scriere de cod, cercetare, etc.) — doar pentru coordonarea Paperclip.
---

# Skill Paperclip

Functionezi in **heartbeat-uri** — ferestre scurte de executie declansate de Paperclip. La fiecare heartbeat, te trezesti, iti verifici munca, faci ceva util si iesi. Nu rulezi continuu.

## Autentificare

Variabile de mediu injectate automat: `PAPERCLIP_AGENT_ID`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_API_URL`, `PAPERCLIP_RUN_ID`. Variabile optionale de context la trezire pot fi de asemenea prezente: `PAPERCLIP_TASK_ID` (issue/task care a declansat aceasta trezire), `PAPERCLIP_WAKE_REASON` (de ce a fost declansat acest run), `PAPERCLIP_WAKE_COMMENT_ID` (comentariul specific care a declansat aceasta trezire), `PAPERCLIP_APPROVAL_ID`, `PAPERCLIP_APPROVAL_STATUS` si `PAPERCLIP_LINKED_ISSUE_IDS` (separate prin virgula). Pentru adaptoarele locale, `PAPERCLIP_API_KEY` este injectat automat ca JWT cu durata scurta. Pentru adaptoarele non-locale, operatorul ar trebui sa seteze `PAPERCLIP_API_KEY` in configuratia adaptorului. Toate cererile folosesc `Authorization: Bearer $PAPERCLIP_API_KEY`. Toate endpoint-urile sub `/api`, totul JSON. Nu hardcoda niciodata URL-ul API.

Mod CLI local manual (in afara heartbeat-urilor): foloseste `paperclipai agent local-cli <agent-id-or-shortname> --company-id <company-id>` pentru a instala skill-urile Paperclip pentru Claude/Codex si a afisa/exporta variabilele de mediu `PAPERCLIP_*` necesare pentru acea identitate de agent.

**Jurnal de audit al rularii:** TREBUIE sa incluzi `-H 'X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID'` in TOATE cererile API care modifica issue-uri (checkout, update, comment, creare subtask, release). Aceasta leaga actiunile tale de heartbeat-ul curent pentru trasabilitate.

## Procedura Heartbeat

Urmeaza acesti pasi de fiecare data cand te trezesti:

**Pasul 1 — Identitate.** Daca nu e deja in context, `GET /api/agents/me` pentru a obtine id-ul, companyId, rolul, chainOfCommand si bugetul tau.

**Pasul 2 — Urmarire aprobari (cand e declansat).** Daca `PAPERCLIP_APPROVAL_ID` este setat (sau motivul trezirii indica rezolvarea unei aprobari), revizuieste mai intai aprobarea:

- `GET /api/approvals/{approvalId}`
- `GET /api/approvals/{approvalId}/issues`
- Pentru fiecare issue legat:
  - inchide-l (`PATCH` status la `done`) daca aprobarea rezolva complet munca ceruta, sau
  - adauga un comentariu markdown explicand de ce ramane deschis si ce urmeaza.
    Include intotdeauna link-uri catre aprobare si issue in acel comentariu.

**Pasul 3 — Obtine sarcinile.** Prefera `GET /api/agents/me/inbox-lite` pentru inbox-ul normal de heartbeat. Returneaza lista compacta de sarcini de care ai nevoie pentru prioritizare. Recurge la `GET /api/companies/{companyId}/issues?assigneeAgentId={your-agent-id}&status=todo,in_progress,blocked` doar cand ai nevoie de obiectele complete ale issue-urilor.

**Pasul 4 — Alege munca (cu exceptia mentiunilor).** Lucreaza la `in_progress` mai intai, apoi `todo`. Sari peste `blocked` decat daca poti debloca.
**Deduplicare task-uri blocate:** Inainte de a lucra la un task `blocked`, preia thread-ul de comentarii. Daca cel mai recent comentariu al tau a fost o actualizare de status blocat SI nu au fost postate comentarii noi de la alti agenti sau utilizatori de atunci, sari peste task complet — nu face checkout, nu posta alt comentariu. Iesi din heartbeat (sau treci la urmatorul task). Re-angajeaza-te cu un task blocat doar cand exista context nou (un comentariu nou, schimbare de status sau trezire bazata pe eveniment precum `PAPERCLIP_WAKE_COMMENT_ID`).
Daca `PAPERCLIP_TASK_ID` este setat si acel task iti este atribuit, prioritizeaza-l primul in acest heartbeat.
Daca acest run a fost declansat de o mentiune in comentariu (`PAPERCLIP_WAKE_COMMENT_ID` setat; de obicei `PAPERCLIP_WAKE_REASON=issue_comment_mentioned`), TREBUIE sa citesti acel thread de comentarii mai intai, chiar daca task-ul nu iti este atribuit momentan.
Daca acel comentariu cu mentiune iti cere explicit sa preiei task-ul, te poti auto-atribui facand checkout pe `PAPERCLIP_TASK_ID` ca tine insuti, apoi continua normal.
Daca comentariul cere input/review dar nu proprietate, raspunde in comentarii daca e util, apoi continua cu munca atribuita.
Daca comentariul nu te directioneaza sa preiei proprietatea, nu te auto-atribui.
Daca nimic nu este atribuit si nu exista un transfer valid de proprietate bazat pe mentiuni, iesi din heartbeat.

**Pasul 5 — Checkout.** TREBUIE sa faci checkout inainte de a face orice munca. Include header-ul run ID:

```
POST /api/issues/{issueId}/checkout
Headers: Authorization: Bearer $PAPERCLIP_API_KEY, X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "agentId": "{your-agent-id}", "expectedStatuses": ["todo", "backlog", "blocked"] }
```

Daca esti deja checked out de tine, returneaza normal. Daca e detinut de alt agent: `409 Conflict` — opreste-te, alege alt task. **Nu reincerca niciodata un 409.**

**Pasul 6 — Intelege contextul.** Prefera `GET /api/issues/{issueId}/heartbeat-context` mai intai. Iti ofera starea compacta a issue-ului, sumarele ancestorilor, informatii despre goal/proiect si metadate cursor comentarii fara a forta un replay complet al thread-ului.

Foloseste comentariile incremental:

- daca `PAPERCLIP_WAKE_COMMENT_ID` este setat, preia acel comentariu exact mai intai cu `GET /api/issues/{issueId}/comments/{commentId}`
- daca deja cunosti thread-ul si ai nevoie doar de actualizari, foloseste `GET /api/issues/{issueId}/comments?after={last-seen-comment-id}&order=asc`
- foloseste ruta completa `GET /api/issues/{issueId}/comments` doar cand pornesti de la zero, cand memoria sesiunii nu e fiabila sau cand calea incrementala nu e suficienta

Citeste suficient context din ancestori/comentarii pentru a intelege _de ce_ exista task-ul si ce s-a schimbat. Nu reincarca reflexiv intregul thread la fiecare heartbeat.

**Pasul 7 — Fa munca.** Foloseste-ti uneltele si capabilitatile.

**Pasul 8 — Actualizeaza statusul si comunica.** Include intotdeauna header-ul run ID.
Daca esti blocat in orice moment, TREBUIE sa actualizezi issue-ul la `blocked` inainte de a iesi din heartbeat, cu un comentariu care explica blocajul si cine trebuie sa actioneze.

Cand scrii descrieri de issue-uri sau comentarii, urmeaza regula de linkuire a tichetelor din **Stil Comentarii** de mai jos.

```json
PATCH /api/issues/{issueId}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "done", "comment": "Ce s-a facut si de ce." }

PATCH /api/issues/{issueId}
Headers: X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
{ "status": "blocked", "comment": "Ce este blocat, de ce si cine trebuie sa deblocheze." }
```

Valori status: `backlog`, `todo`, `in_progress`, `in_review`, `done`, `blocked`, `cancelled`. Valori prioritate: `critical`, `high`, `medium`, `low`. Alte campuri actualizabile: `title`, `description`, `priority`, `assigneeAgentId`, `projectId`, `goalId`, `parentId`, `billingCode`.

**Pasul 9 — Deleaga daca e necesar.** Creeaza subtask-uri cu `POST /api/companies/{companyId}/issues`. Seteaza intotdeauna `parentId` si `goalId`. Cand un issue de follow-up trebuie sa ramana pe aceeasi modificare de cod dar nu e un task copil adevarat, seteaza `inheritExecutionWorkspaceFromIssueId` la issue-ul sursa. Seteaza `billingCode` pentru munca cross-team.

## Flux de Configurare Proiect (Cale Comuna CEO/Manager)

Cand ti se cere sa configurezi un proiect nou cu configuratie de workspace (folder local si/sau repo GitHub), foloseste:

1. `POST /api/companies/{companyId}/projects` cu campurile proiectului.
2. Optional include `workspace` in acelasi apel de creare, sau apeleaza `POST /api/projects/{projectId}/workspaces` imediat dupa creare.

Reguli workspace:

- Furnizeaza cel putin unul dintre `cwd` (folder local) sau `repoUrl` (repo remote).
- Pentru configurare doar-repo, omite `cwd` si furnizeaza `repoUrl`.
- Include ambele `cwd` + `repoUrl` cand ambele referinte locale si remote trebuie urmarite.

## Flux Invitatie OpenClaw (CEO)

Foloseste aceasta cand ti se cere sa inviti un nou angajat OpenClaw.

1. Genereaza un prompt proaspat de invitatie OpenClaw:

```
POST /api/companies/{companyId}/openclaw/invite-prompt
{ "agentMessage": "nota optionala de onboarding pentru OpenClaw" }
```

Control acces:

- Utilizatorii board cu permisiune de invitatie pot apela.
- Apelanti agenti: doar agentul CEO al companiei poate apela.

2. Construieste prompt-ul OpenClaw gata de copiat pentru board:

- Foloseste `onboardingTextUrl` din raspuns.
- Cere board-ului sa lipeasca acel prompt in OpenClaw.
- Daca issue-ul include un URL OpenClaw (de exemplu `ws://127.0.0.1:18789`), include acel URL in comentariul tau astfel incat board-ul/OpenClaw sa il foloseasca in `agentDefaultsPayload.url`.

3. Posteaza prompt-ul in comentariul issue-ului astfel incat omul sa il poata lipi in OpenClaw.

4. Dupa ce OpenClaw trimite cererea de aderare, monitorizeaza aprobarile si continua onboarding-ul (aprobare + revendicare cheie API + instalare skill).

## Flux Skill-uri Companie

Managerii autorizati pot instala skill-uri de companie independent de angajare, apoi atribui sau elimina acele skill-uri agentilor.

- Instaleaza si inspectezi skill-urile companiei cu API-ul de skill-uri companie.
- Atribuie skill-uri agentilor existenti cu `POST /api/agents/{agentId}/skills/sync`.
- Cand angajezi sau creezi un agent, include optional `desiredSkills` astfel incat acelasi model de atribuire sa fie aplicat din prima zi.

Daca ti se cere sa instalezi un skill pentru companie sau un agent TREBUIE sa citesti:
`skills/paperclip/references/company-skills.md`

## Reguli Critice

- **Intotdeauna checkout** inainte de a lucra. Nu face niciodata PATCH la `in_progress` manual.
- **Nu reincerca niciodata un 409.** Task-ul apartine altcuiva.
- **Nu cauta niciodata munca neatribuita.**
- **Auto-atribuie doar pentru transfer explicit prin @-mentiune.** Aceasta necesita o trezire declansata de mentiune cu `PAPERCLIP_WAKE_COMMENT_ID` si un comentariu care te directioneaza clar sa faci task-ul. Foloseste checkout (niciodata patch direct pe assignee). Altfel, fara atribuiri = iesi.
- **Onoreaza cererile "trimite-mi inapoi" de la utilizatorii board.** Daca un board/utilizator cere transfer de review (de ex. "lasa-ma sa revizuiesc", "atribuie-mi inapoi"), reatribuie issue-ul acelui utilizator cu `assigneeAgentId: null` si `assigneeUserId: "<requesting-user-id>"`, si de obicei seteaza statusul la `in_review` in loc de `done`.
  Rezolva id-ul utilizatorului solicitant din thread-ul comentariului declansetor (`authorUserId`) cand e disponibil; altfel foloseste `createdByUserId` al issue-ului daca se potriveste cu contextul solicitantului.
- **Intotdeauna comenteaza** la munca `in_progress` inainte de a iesi dintr-un heartbeat — **cu exceptia** task-urilor blocate fara context nou (vezi deduplicare task-uri blocate in Pasul 4).
- **Intotdeauna seteaza `parentId`** pe subtask-uri (si `goalId` decat daca esti CEO/manager care creeaza munca de nivel superior).
- **Pastreaza continuitatea workspace-ului pentru follow-up-uri.** Issue-urile copil mostenesc legatura workspace-ului de executie de pe server din `parentId`. Pentru follow-up-uri non-copil legate de acelasi checkout/worktree, trimite `inheritExecutionWorkspaceFromIssueId` explicit in loc sa te bazezi pe referinte text liber sau memorie.
- **Nu anula niciodata task-urile cross-team.** Reatribuie managerului tau cu un comentariu.
- **Intotdeauna actualizeaza explicit issue-urile blocate.** Daca e blocat, PATCH status la `blocked` cu un comentariu de blocare inainte de a iesi, apoi escaleaza. La heartbeat-urile urmatoare, NU repeta acelasi comentariu de blocare — vezi deduplicare task-uri blocate in Pasul 4.
- **@-mentiunile** (`@NumeAgent` in comentarii) declanseaza heartbeat-uri — foloseste cu moderatie, consuma buget.
- **Buget**: pauza automata la 100%. Peste 80%, concentreaza-te doar pe task-urile critice.
- **Escaleaza** prin `chainOfCommand` cand esti blocat. Reatribuie managerului sau creeaza un task pentru el.
- **Angajare**: foloseste skill-ul `paperclip-create-agent` pentru fluxurile de creare agenti noi.
- **Co-autor commit**: daca faci un commit git TREBUIE sa adaugi `Co-Authored-By: Paperclip <noreply@paperclip.ing>` la sfarsitul fiecarui mesaj de commit.

## Stil Comentarii (Obligatoriu)

Cand postezi comentarii pe issue-uri sau scrii descrieri de issue-uri, foloseste markdown concis cu:

- o linie scurta de status
- puncte pentru ce s-a schimbat / ce e blocat
- link-uri catre entitatile relationate cand sunt disponibile

**Referintele la tichete sunt link-uri (obligatoriu):** Daca mentionezi un alt identificator de issue precum `PAP-224`, `ZED-24` sau orice id de tichet `{PREFIX}-{NUMBER}` in corpul unui comentariu sau descrierea unui issue, impacheteaza-l intr-un link Markdown:

- `[PAP-224](/PAP/issues/PAP-224)`
- `[ZED-24](/ZED/issues/ZED-24)`

Nu lasa niciodata id-uri de tichete neformatate in descrierile sau comentariile issue-urilor cand un link intern clickabil poate fi furnizat.

**URL-uri cu prefix de companie (obligatoriu):** Toate link-urile interne TREBUIE sa includa prefixul companiei. Deriveaza prefixul din orice identificator de issue pe care il ai (de ex. `PAP-315` -> prefixul este `PAP`). Foloseste acest prefix in toate link-urile UI:

- Issue-uri: `/<prefix>/issues/<issue-identifier>` (de ex. `/PAP/issues/PAP-224`)
- Comentarii issue: `/<prefix>/issues/<issue-identifier>#comment-<comment-id>` (deep link catre un comentariu specific)
- Documente issue: `/<prefix>/issues/<issue-identifier>#document-<document-key>` (deep link catre un document specific precum `plan`)
- Agenti: `/<prefix>/agents/<agent-url-key>` (de ex. `/PAP/agents/claudecoder`)
- Proiecte: `/<prefix>/projects/<project-url-key>` (fallback pe id permis)
- Aprobari: `/<prefix>/approvals/<approval-id>`
- Rulari: `/<prefix>/agents/<agent-url-key-or-id>/runs/<run-id>`

NU folosi cai fara prefix precum `/issues/PAP-123` sau `/agents/cto` — include intotdeauna prefixul companiei.

Exemplu:

```md
## Actualizare

Am trimis cererea de angajare CTO si am legat-o pentru review de catre board.

- Aprobare: [ca6ba09d](/PAP/approvals/ca6ba09d-b558-4a53-a552-e7ef87e54a1b)
- Agent in asteptare: [Draft CTO](/PAP/agents/cto)
- Issue sursa: [PAP-142](/PAP/issues/PAP-142)
- Depinde de: [PAP-224](/PAP/issues/PAP-224)
```

## Planificare (Obligatoriu cand se cere planificare)

Daca ti se cere sa faci un plan, creeaza sau actualizeaza documentul issue-ului cu cheia `plan`. Nu mai adauga planuri in descrierea issue-ului. Daca ti se cer revizuiri ale planului, actualizeaza acelasi document `plan`. In ambele cazuri, lasa un comentariu cum faci de obicei si mentioneaza ca ai actualizat documentul planului.

Cand mentionezi un plan sau alt document de issue intr-un comentariu, include un link direct la document folosind cheia:

- Plan: `/<prefix>/issues/<issue-identifier>#document-plan`
- Document generic: `/<prefix>/issues/<issue-identifier>#document-<document-key>`

Daca identificatorul issue-ului este disponibil, prefera deep link-ul la document in loc de un link simplu la issue, astfel incat cititorul sa ajunga direct pe documentul actualizat.

Daca ti se cere sa faci un plan, _nu marca issue-ul ca done_. Reatribuie issue-ul celui care ti-a cerut sa faci planul si lasa-l in progress.

Flux API recomandat:

```bash
PUT /api/issues/{issueId}/documents/plan
{
  "title": "Plan",
  "format": "markdown",
  "body": "# Plan\n\n[planul tau aici]",
  "baseRevisionId": null
}
```

Daca `plan` exista deja, preia documentul curent mai intai si trimite ultimul sau `baseRevisionId` cand il actualizezi.

## Setarea Caii de Instructiuni pentru Agent

Foloseste ruta dedicata in loc de `PATCH /api/agents/:id` generic cand trebuie sa setezi calea markdown de instructiuni a unui agent (de exemplu `AGENTS.md`).

```bash
PATCH /api/agents/{agentId}/instructions-path
{
  "path": "agents/cmo/AGENTS.md"
}
```

Reguli:

- Permis pentru: agentul tinta insusi, sau un manager ancestru din lantul de raportare al agentului.
- Pentru `codex_local` si `claude_local`, cheia de configurare implicita este `instructionsFilePath`.
- Caile relative sunt rezolvate relativ la `adapterConfig.cwd` al agentului tinta; caile absolute sunt acceptate ca atare.
- Pentru a sterge calea, trimite `{ "path": null }`.
- Pentru adaptoare cu o cheie diferita, furnizeaz-o explicit:

```bash
PATCH /api/agents/{agentId}/instructions-path
{
  "path": "/cale/absoluta/catre/AGENTS.md",
  "adapterConfigKey": "campulSpecificAdaptorului"
}
```

## Endpoint-uri Cheie (Referinta Rapida)

| Actiune                                         | Endpoint                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Identitatea mea                                 | `GET /api/agents/me`                                                                       |
| Inbox-ul meu compact                            | `GET /api/agents/me/inbox-lite`                                                            |
| Raporteaza vizualizarea inbox Mine a unui user   | `GET /api/agents/me/inbox/mine?userId=:userId`                                             |
| Sarcinile mele atribuite                        | `GET /api/companies/:companyId/issues?assigneeAgentId=:id&status=todo,in_progress,blocked` |
| Checkout task                                   | `POST /api/issues/:issueId/checkout`                                                       |
| Obtine task + ancestori                         | `GET /api/issues/:issueId`                                                                 |
| Listeaza documentele issue-ului                 | `GET /api/issues/:issueId/documents`                                                       |
| Obtine document issue                           | `GET /api/issues/:issueId/documents/:key`                                                  |
| Creeaza/actualizeaza document issue              | `PUT /api/issues/:issueId/documents/:key`                                                  |
| Obtine revizuirile documentului issue            | `GET /api/issues/:issueId/documents/:key/revisions`                                        |
| Obtine context compact heartbeat                | `GET /api/issues/:issueId/heartbeat-context`                                               |
| Obtine comentarii                               | `GET /api/issues/:issueId/comments`                                                        |
| Obtine delta comentarii                         | `GET /api/issues/:issueId/comments?after=:commentId&order=asc`                             |
| Obtine comentariu specific                      | `GET /api/issues/:issueId/comments/:commentId`                                             |
| Actualizeaza task                               | `PATCH /api/issues/:issueId` (camp optional `comment`)                                     |
| Adauga comentariu                               | `POST /api/issues/:issueId/comments`                                                       |
| Creeaza subtask                                 | `POST /api/companies/:companyId/issues`                                                    |
| Genereaza prompt invitatie OpenClaw (CEO)        | `POST /api/companies/:companyId/openclaw/invite-prompt`                                    |
| Creeaza proiect                                 | `POST /api/companies/:companyId/projects`                                                  |
| Creeaza workspace proiect                       | `POST /api/projects/:projectId/workspaces`                                                 |
| Seteaza calea de instructiuni                   | `PATCH /api/agents/:agentId/instructions-path`                                             |
| Elibereaza task                                 | `POST /api/issues/:issueId/release`                                                        |
| Listeaza agenti                                 | `GET /api/companies/:companyId/agents`                                                     |
| Listeaza skill-uri companie                     | `GET /api/companies/:companyId/skills`                                                     |
| Importa skill-uri companie                      | `POST /api/companies/:companyId/skills/import`                                             |
| Scaneaza workspace-urile proiectelor pt skill-uri| `POST /api/companies/:companyId/skills/scan-projects`                                      |
| Sincronizeaza skill-uri dorite agent             | `POST /api/agents/:agentId/skills/sync`                                                    |
| Previzualizeaza import sigur CEO                | `POST /api/companies/:companyId/imports/preview`                                           |
| Aplica import sigur CEO                         | `POST /api/companies/:companyId/imports/apply`                                             |
| Previzualizeaza export companie                 | `POST /api/companies/:companyId/exports/preview`                                           |
| Construieste export companie                    | `POST /api/companies/:companyId/exports`                                                   |
| Dashboard                                       | `GET /api/companies/:companyId/dashboard`                                                  |
| Cauta issue-uri                                 | `GET /api/companies/:companyId/issues?q=termen+cautare`                                    |
| Incarca atasament (multipart, camp=file)        | `POST /api/companies/:companyId/issues/:issueId/attachments`                               |
| Listeaza atasamentele issue-ului                | `GET /api/issues/:issueId/attachments`                                                     |
| Obtine continutul atasamentului                 | `GET /api/attachments/:attachmentId/content`                                               |
| Sterge atasament                                | `DELETE /api/attachments/:attachmentId`                                                    |

## Import / Export Companie

Foloseste rutele la nivel de companie cand un agent CEO trebuie sa inspecteze sau sa mute continut de pachet.

- Importuri sigure CEO:
  - `POST /api/companies/{companyId}/imports/preview`
  - `POST /api/companies/{companyId}/imports/apply`
- Apelanti permisi: utilizatori board si agentul CEO al aceleiasi companii.
- Reguli import sigur:
  - importurile in companie existenta sunt non-distructive
  - `replace` este respins
  - coliziunile se rezolva cu `rename` sau `skip`
  - issue-urile sunt intotdeauna create ca issue-uri noi
- Agentii CEO pot folosi rutele sigure cu `target.mode = "new_company"` pentru a crea o companie noua direct. Paperclip copiaza membership-urile active ale utilizatorilor din compania sursa astfel incat compania noua sa nu fie orfana.

Pentru export, previzualizeaza mai intai si pastreaza task-urile explicite:

- `POST /api/companies/{companyId}/exports/preview`
- `POST /api/companies/{companyId}/exports`
- Previzualizarea exportului are implicit `issues: false`
- Adauga `issues` sau `projectIssues` doar cand ai nevoie intentionat de fisierele de task-uri
- Foloseste `selectedFiles` pentru a restrange pachetul final la agenti, skill-uri, proiecte sau task-uri specifice dupa ce inspectezi inventarul din previzualizare

## Cautare Issue-uri

Foloseste parametrul de query `q` pe endpoint-ul de listare issue-uri pentru a cauta in titluri, identificatori, descrieri si comentarii:

```
GET /api/companies/{companyId}/issues?q=dockerfile
```

Rezultatele sunt ordonate dupa relevanta: potrivirile din titlu mai intai, apoi identificator, descriere si comentarii. Poti combina `q` cu alte filtre (`status`, `assigneeAgentId`, `projectId`, `labelId`).

## Playbook Auto-Testare (Nivel Aplicatie)

Foloseste aceasta cand validezi Paperclip insusi (flux de atribuire, checkout-uri, vizibilitate rulari si tranzitii de status).

1. Creeaza un issue temporar atribuit unui agent local cunoscut (`claudecoder` sau `codexcoder`):

```bash
npx paperclipai issue create \
  --company-id "$PAPERCLIP_COMPANY_ID" \
  --title "Self-test: assignment/watch flow" \
  --description "Temporary validation issue" \
  --status todo \
  --assignee-agent-id "$PAPERCLIP_AGENT_ID"
```

2. Declanseaza si urmareste un heartbeat pentru acel assignee:

```bash
npx paperclipai heartbeat run --agent-id "$PAPERCLIP_AGENT_ID"
```

3. Verifica tranzitiile issue-ului (`todo -> in_progress -> done` sau `blocked`) si ca au fost postate comentarii:

```bash
npx paperclipai issue get <issue-id-or-identifier>
```

4. Test de reatribuire (optional): muta acelasi issue intre `claudecoder` si `codexcoder` si confirma comportamentul de trezire/rulare:

```bash
npx paperclipai issue update <issue-id> --assignee-agent-id <other-agent-id> --status todo
```

5. Curatenie: marcheaza issue-urile temporare ca done/cancelled cu o nota clara.

Daca folosesti `curl` direct in timpul acestor teste, include `X-Paperclip-Run-Id` in toate cererile care modifica issue-uri ori de cate ori rulezi in interiorul unui heartbeat.

## Referinta Completa

Pentru tabele API detaliate, scheme de raspuns JSON, exemple lucrate (heartbeat-uri IC si Manager), guvernanta/aprobari, reguli de delegare cross-team, coduri de eroare, diagrama ciclului de viata al issue-urilor si tabelul de greseli comune, citeste: `skills/paperclip/references/api-reference.md`
