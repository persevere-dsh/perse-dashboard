/** Deterministic model adapter; only used by the native sim lane. Real DSH tools execute every call. */
import { appendFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
export const inject = ['llm']
class SimulationAdapter extends LlmAdapter {
  constructor(ctx) {
    super()
    this.ctx = ctx
  }
  async listModels() {
    return [
      {
        provider: 'dashboard-sim',
        id: 'sim',
        name: 'Deterministic simulation',
        context: { maxTokens: 64000 },
        inputModalities: ['text', 'image'],
      },
      {
        provider: 'dashboard-sim',
        id: 'sim-text',
        name: 'Deterministic text-only simulation',
        context: { maxTokens: 64000 },
        inputModalities: ['text'],
      },
    ]
  }
  async resolveModel(provider, model) {
    const listed = (await this.listModels()).find(
      (candidate) => candidate.provider === provider && candidate.id === model,
    )
    return listed
      ? {
          provider: listed.provider,
          id: listed.id,
          name: listed.name,
          inputModalities: listed.inputModalities,
        }
      : { provider, id: model, name: model }
  }
  /** Hash the exact durable bytes a route would resolve for each image block. */
  async traceImages(blocks) {
    const images = []
    for (const block of blocks) {
      const entry = {
        attachmentId: block.attachment.attachmentId,
        mediaType: block.attachment.mediaType,
        bytes: block.attachment.bytes,
        width: block.attachment.width,
        height: block.attachment.height,
        name: block.attachment.name ?? null,
        sha256: null,
        error: null,
      }
      try {
        const stored = await this.ctx.get('attachments').readImage(block.attachment)
        entry.sha256 = createHash('sha256').update(stored.data).digest('hex')
      } catch (error) {
        entry.error = String(error)
      }
      images.push(entry)
    }
    return images
  }
  async *stream(options) {
    options.signal?.throwIfAborted()
    const messages = options.messages
    const lastUser = messages.findLastIndex(
      (m) =>
        m.role === 'user' &&
        (m.content ?? []).some(
          (b) =>
            b.type === 'text' &&
            /PERSE_PHASE=|dashboard_claim_next/.test(b.text),
        ),
    )
    const tail = messages.slice(lastUser + 1)
    const toolResults = tail.filter((m) => m.role === 'tool')
    const promptContent = messages[lastUser]?.content ?? []
    const user = promptContent
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
    const factLine = user.match(/^TASK_DATA=(.+)$/m)?.[1]
    const data = factLine ? JSON.parse(factLine) : null
    // Prompts carry a language-independent phase marker; wording is localized.
    const phase =
      user.match(/PERSE_PHASE=(analysis|execution|review)/)?.[1] ??
      (user.includes('dashboard_claim_next') ? 'handoff' : 'other')
    const reminder = /^REPORT_REMINDER: /m.test(user)
    const chinese = data?.language === 'zh'
    const text = (en, zh) => (chinese ? zh : en)
    const imageBlocks = promptContent.filter((b) => b.type === 'image')
    await appendFile(
      path.join(process.env.DSH_HOME, 'sim-model-trace.jsonl'),
      JSON.stringify({
        phase,
        language: data?.language ?? null,
        taskId: data?.taskId ?? null,
        version: data?.version ?? null,
        reminder,
        roles: messages.map((m) => m.role),
        user,
        labels: promptContent
          .filter((b) => b.type === 'text' && b.text.startsWith('INPUT_IMAGE '))
          .map((b) => b.text),
        imageBlocks: imageBlocks.length,
        images: await this.traceImages(imageBlocks),
        toolResults,
      }) + '\n',
    )
    const call = (name, args) => ({
      type: 'tool-call',
      id: crypto.randomUUID(),
      name,
      arguments: JSON.stringify(args),
    })
    let block
    const quote = (value) =>
      "'" + String(value).replaceAll("'", "'\"'\"'") + "'"
    if (phase === 'analysis' && data && !toolResults.length) {
      if (
        data.description.includes('PERSE_MISSING_ANALYSIS') ||
        (data.description.includes('PERSE_MISSING_ONCE') && !reminder)
      ) {
        block = {
          type: 'reasoning',
          text: 'Simulation: analysis reasoning ended before reporting.',
        }
      } else
        block = call('dashboard_triage', {
          taskId: data.taskId,
          expectedVersion: data.version,
          criteria: data.criteria.length
            ? data.criteria
            : [text('Native workspace artifact is verified', '原生工作区产物已通过验证')],
          analysis: {
            summary: text(
              'Deterministic analysis through the actual DSH tool',
              '通过真实 DSH 工具生成的确定性分析',
            ),
            plan: text(
              [
                'Produce isolated artifact',
                'Read back result',
                'Report evidence',
              ],
              ['生成隔离产物', '读回结果', '提交证据'],
            ),
            risk: 'low',
            route: 'express',
            questions: [],
          },
        })
    } else if (phase === 'review' && data) {
      if (!toolResults.length)
        block = call('bash', {
          command: data.completionPolicy.checks.length
            ? data.completionPolicy.checks
                .map((c) => 'cat -- ' + quote(c.path))
                .join(' && ')
            : 'cat sim-shell.txt',
          description: text(
            'Independently read the actual native workspace artifact',
            '独立读取真实原生工作区产物',
          ),
        })
      else if (toolResults.length === 1)
        block = call('dashboard_review', {
          taskId: data.taskId,
          expectedVersion: data.version,
          review: {
            verdict: 'pass',
            risk: 'low',
            results: data.criteria.map((c, criterion) => ({
              criterion,
              passed: true,
              evidence: text(
                'Actual native shell readback: ',
                '原生 shell 实际读回：',
              ) + JSON.stringify(toolResults[0].content),
            })),
            remainingRisks: [],
            evidence: text(
              'Independent native DSH Session read the workspace artifact using its actual bash tool.',
              '独立原生 DSH 会话使用真实 bash 工具读取了工作区产物。',
            ),
          },
        })
    } else if (
      phase === 'execution' &&
      data?.description.includes('PERSE_APPROVAL_PROBE')
    ) {
      if (!toolResults.length) block = call('sim_request_approval', {})
      else if (toolResults.length === 1 && data)
        block = call('dashboard_report', {
          taskId: data.taskId,
          expectedVersion: data.version,
          outcome: 'blocked',
          evidence: text(
            'Approval probe was resolved without granting the protected write: ',
            '审批探测已结束，但未授予受保护写入：',
          ) + JSON.stringify(toolResults[0].content),
        })
    } else if (phase === 'execution' && data) {
      if (!toolResults.length)
        block = call('bash', {
          command:
            'printf DSH_SIM_SHELL_OK > sim-shell.txt' +
            (data?.description.includes('PERSE_IMAGE_EVIDENCE')
              ? ` && python3 -c ${quote("import base64;open('proof.png','wb').write(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC'))")}`
              : '') +
            (data?.completionPolicy.checks ?? [])
              .filter((c) => c.kind === 'text-equals')
              .map(
                (c) =>
                  ' && printf %s ' + quote(c.expected) + ' > ' + quote(c.path),
              )
              .join(''),
          description: text(
            'Verify a native DSH workspace tool',
            '验证真实 DSH 工作区工具',
          ),
        })
      else if (toolResults.length === 1)
        block = call('dashboard_report', {
          taskId: data.taskId,
          expectedVersion: data.version,
          evidence: text(
            'SIM: real DSH tool execution verified; deterministic model, no external inference.',
            'SIM：已通过真实 DSH 工具执行验证；使用确定性模型，无外部推理。',
          ),
          images: data?.description.includes('PERSE_IMAGE_EVIDENCE')
            ? [
                {
                  path: 'proof.png',
                  caption: text('Native image readback', '原生图片读回'),
                  criterion: 0,
                },
              ]
            : [],
        })
    } else if (phase === 'handoff') {
      const id = user.match(/taskId "([^"]+)"/)
      if (!toolResults.length)
        block = call('dashboard_claim_next', id ? { taskId: id[1] } : {})
      else if (toolResults.length === 1) {
        const payload = toolResults[0].content.find(
          (b) => b.type === 'text',
        )?.text
        const task = JSON.parse(payload)
        block = call('dashboard_report', {
          taskId: task.id,
          expectedVersion: task.version,
          evidence:
            'SIM: task claimed and reported through official DSH Agent tools.',
        })
      }
    }
    if (!block)
      block = {
        type: 'text',
        text: 'SIM_NATIVE_OK: verified the native dashboard task workflow.',
      }
    yield { type: 'block-start', index: 0, blockType: block.type }
    yield { type: 'block-end', index: 0, block }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } }
    yield {
      type: 'finish',
      reason: { kind: block.type === 'tool-call' ? 'tool-calls' : 'stop' },
    }
  }
}
export function apply(ctx) {
  ctx.effect(
    () => ctx.llm.registerAdapter(['dashboard-sim'], new SimulationAdapter(ctx)),
    'dashboard sim adapter',
  )
}
