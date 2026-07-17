import { Dices, LoaderCircle, Settings2, Sparkles } from 'lucide-react';

const QUICK_DIRECTIONS = ['男频爽文', '女频情感', '悬疑', '科幻', '仙侠', '现实题材'];

export default function IdeaDrawPanel({
  artifact,
  configured,
  onChange,
  onDraw,
  onSettings,
}) {
  const draw = artifact.draw ?? {};
  const mode = draw.mode === 'guided' ? 'guided' : 'random';
  const constraints = String(draw.constraints ?? '');
  const busy = artifact.status === 'generating';
  const hasSuggestion = artifact.suggestion != null;

  const patchDraw = (patch) => onChange({
    mode,
    constraints,
    ...patch,
  });

  const addDirection = (direction) => {
    const parts = constraints.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);
    if (!parts.includes(direction)) parts.push(direction);
    patchDraw({ mode: 'guided', constraints: parts.join('，') });
  };

  return (
    <section className="idea-draw-panel" aria-labelledby="idea-draw-title">
      <div className="idea-draw-heading">
        <div className="idea-draw-icon"><Dices size={20} /></div>
        <div>
          <span className="section-kicker">AI 灵感抽卡</span>
          <h2 id="idea-draw-title">没有 Idea？先抽一张</h2>
          <p>不需要先写书名。可以完全随机，也可以只给一个大概方向。</p>
        </div>
      </div>

      <div className="idea-draw-controls">
        <div className="idea-draw-mode" role="radiogroup" aria-label="抽卡模式">
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'random'}
            className={mode === 'random' ? 'active' : ''}
            onClick={() => patchDraw({ mode: 'random' })}
            disabled={busy}
          >
            完全随机
            <small>不设题材和人物限制</small>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === 'guided'}
            className={mode === 'guided' ? 'active' : ''}
            onClick={() => patchDraw({ mode: 'guided' })}
            disabled={busy}
          >
            限定方向
            <small>按你的大概要求组合</small>
          </button>
        </div>

        {mode === 'guided' && (
          <div className="idea-draw-guidance">
            <textarea
              rows={4}
              value={constraints}
              onChange={(event) => patchDraw({ constraints: event.target.value })}
              disabled={busy}
              maxLength={4000}
              placeholder="例如：男频末世，普通人主角，不要系统，重点写生存压力；或者只写“轻松仙侠”。"
            />
            <div className="idea-draw-chips" aria-label="快速添加方向">
              {QUICK_DIRECTIONS.map((direction) => (
                <button type="button" key={direction} onClick={() => addDirection(direction)} disabled={busy}>+ {direction}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="idea-draw-actions">
        <span>结果只进入建议稿；不会自动定书名、确认设定或推进下游。</span>
        <button
          type="button"
          className={`${hasSuggestion ? 'secondary-button' : 'primary-button'} idea-draw-button`}
          onClick={configured ? onDraw : onSettings}
          disabled={busy}
        >
          {busy ? <LoaderCircle size={17} className="spin" /> : configured ? <Sparkles size={17} /> : <Settings2 size={17} />}
          {busy ? '正在抽取 Idea' : configured ? (hasSuggestion ? '再抽一张' : '抽一张 Idea') : '配置 Idea 模型'}
        </button>
      </div>
    </section>
  );
}
