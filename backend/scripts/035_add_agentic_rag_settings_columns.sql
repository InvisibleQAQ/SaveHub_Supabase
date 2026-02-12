-- Add Agentic-RAG prompt and parameter columns to settings table
-- Keep migration idempotent with IF NOT EXISTS

ALTER TABLE public.settings
ADD COLUMN IF NOT EXISTS agentic_rag_top_k INTEGER NOT NULL DEFAULT 8,
ADD COLUMN IF NOT EXISTS agentic_rag_min_score DOUBLE PRECISION NOT NULL DEFAULT 0.35,
ADD COLUMN IF NOT EXISTS agentic_rag_max_split_questions INTEGER NOT NULL DEFAULT 3,
ADD COLUMN IF NOT EXISTS agentic_rag_max_tool_rounds_per_question INTEGER NOT NULL DEFAULT 3,
ADD COLUMN IF NOT EXISTS agentic_rag_max_expand_calls_per_question INTEGER NOT NULL DEFAULT 2,
ADD COLUMN IF NOT EXISTS agentic_rag_retry_tool_on_failure BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS agentic_rag_max_tool_retry INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS agentic_rag_answer_max_tokens INTEGER NOT NULL DEFAULT 900,
ADD COLUMN IF NOT EXISTS agentic_rag_history_summary_temperature DOUBLE PRECISION NOT NULL DEFAULT 0.1,
ADD COLUMN IF NOT EXISTS agentic_rag_history_summary_max_tokens INTEGER NOT NULL DEFAULT 160,
ADD COLUMN IF NOT EXISTS agentic_rag_query_analysis_temperature DOUBLE PRECISION NOT NULL DEFAULT 0.1,
ADD COLUMN IF NOT EXISTS agentic_rag_query_analysis_max_tokens INTEGER NOT NULL DEFAULT 320,
ADD COLUMN IF NOT EXISTS agentic_rag_answer_generation_temperature DOUBLE PRECISION NOT NULL DEFAULT 0.2,
ADD COLUMN IF NOT EXISTS agentic_rag_aggregation_temperature DOUBLE PRECISION NOT NULL DEFAULT 0.2,
ADD COLUMN IF NOT EXISTS agentic_rag_expand_context_window_size INTEGER NOT NULL DEFAULT 2,
ADD COLUMN IF NOT EXISTS agentic_rag_expand_context_top_k_min INTEGER NOT NULL DEFAULT 3,
ADD COLUMN IF NOT EXISTS agentic_rag_expand_context_min_score_delta DOUBLE PRECISION NOT NULL DEFAULT -0.1,
ADD COLUMN IF NOT EXISTS agentic_rag_retry_search_min_score_delta DOUBLE PRECISION NOT NULL DEFAULT -0.08,
ADD COLUMN IF NOT EXISTS agentic_rag_seed_source_limit INTEGER NOT NULL DEFAULT 8,
ADD COLUMN IF NOT EXISTS agentic_rag_finalize_min_sources INTEGER NOT NULL DEFAULT 4,
ADD COLUMN IF NOT EXISTS agentic_rag_finalize_min_high_confidence INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS agentic_rag_evidence_max_sources INTEGER NOT NULL DEFAULT 12,
ADD COLUMN IF NOT EXISTS agentic_rag_evidence_snippet_max_chars INTEGER NOT NULL DEFAULT 380,
ADD COLUMN IF NOT EXISTS agentic_rag_source_content_max_chars INTEGER NOT NULL DEFAULT 700,
ADD COLUMN IF NOT EXISTS agentic_rag_query_analysis_system_prompt TEXT NOT NULL DEFAULT $$你是资深的 RAG 查询分析器。

你的职责：把用户问题改写成适合语义检索的自包含子问题，并判断是否需要澄清。

硬性规则：
1. 只能基于用户输入与对话历史，不得编造实体或条件。
2. 问题不清楚时必须标记为不清晰，并给出中文澄清问题。
3. 如果有多个独立信息需求，可拆成最多 3 个子问题。
4. 每个子问题都必须可直接检索，不允许“这个/那个/它”这类指代。

请只输出 JSON（不要 markdown），结构必须是：
{
  "is_clear": true,
  "questions": ["..."],
  "clarification_needed": "...",
  "reason": "..."
}

字段约束：
- is_clear: 布尔值
- questions: 字符串数组；is_clear=true 时至少 1 条
- clarification_needed: is_clear=false 时必须是可直接发给用户的中文追问
- reason: 20 字以内，用于日志简述$$,
ADD COLUMN IF NOT EXISTS agentic_rag_clarification_prompt TEXT NOT NULL DEFAULT $$我还缺少关键信息。请补充你想查询的对象、时间范围、比较维度或具体场景。$$,
ADD COLUMN IF NOT EXISTS agentic_rag_answer_generation_system_prompt TEXT NOT NULL DEFAULT $$你是严格证据驱动的知识库问答助手。

你只能基于“检索证据”回答，禁止使用外部常识补全。

输出规则：
1. 每个关键结论后必须带引用标记 [ref:N]（N 来自证据编号）。
2. 不允许引用不存在的编号。
3. 若证据不足以回答，必须明确说“知识库暂无相关信息”。
4. 回答用中文，简洁且信息完整。$$,
ADD COLUMN IF NOT EXISTS agentic_rag_aggregation_system_prompt TEXT NOT NULL DEFAULT $$你是多子问题答案聚合助手。

目标：把多个基于证据的答案整合成一段自然、完整、去重的最终回答。

规则：
1. 只使用输入答案里的事实，不新增外部知识。
2. 保留并复用原有 [ref:N] 引用。
3. 若不同答案重复，进行合并；若冲突，保留冲突并说明。
4. 若所有子答案都缺乏信息，输出“知识库暂无相关信息”。$$,
ADD COLUMN IF NOT EXISTS agentic_rag_no_kb_answer TEXT NOT NULL DEFAULT $$知识库暂无相关信息。$$,
ADD COLUMN IF NOT EXISTS agentic_rag_history_summary_system_prompt TEXT NOT NULL DEFAULT $$你是精炼总结助手。$$,
ADD COLUMN IF NOT EXISTS agentic_rag_history_summary_user_prompt_template TEXT NOT NULL DEFAULT $$你是对话摘要助手。请把以下历史对话压缩为 1-2 句中文摘要，保留主题、关键实体和未解决问题。只输出摘要正文。$$;

