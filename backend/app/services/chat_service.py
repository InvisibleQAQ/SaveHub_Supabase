"""
Chat 服务

使用 LangChain 处理聊天请求，使用 Supabase SDK 保存消息。
"""

from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_openai import ChatOpenAI
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from supabase import Client
from uuid import UUID
import logging

logger = logging.getLogger(__name__)

TEMPLATE = """You are a helpful assistant. Respond to all user input with clear, concise, and informative responses.

User: {input}
AI:
"""


async def process_chat(
    model_id: str,
    messages,
    supabase: Client,
    chat_session_id: UUID
):
    """
    处理聊天请求并返回流式响应

    Args:
        model_id: LLM 模型 ID
        messages: 消息列表
        supabase: Supabase 客户端
        chat_session_id: 会话 ID

    Returns:
        StreamingResponse: 流式响应
    """
    current_message_content = messages[-1].content
    prompt = ChatPromptTemplate.from_template(TEMPLATE)

    model = ChatOpenAI(
        temperature=0.8,
        model=model_id,
        streaming=True
    )

    chain = prompt | model | StrOutputParser()

    async def generate_chat_responses():
        full_response = ""
        try:
            async for chunk in chain.astream({"input": current_message_content}):
                # 累积响应
                full_response += chunk
                # 流式发送给客户端
                yield f'0:"{chunk}"\n'
        except Exception as e:
            logger.error(f"Chat streaming error: {e}")
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            # 保存助手响应到数据库
            if full_response:
                try:
                    supabase.table("messages").insert({
                        "chat_session_id": str(chat_session_id),
                        "role": "assistant",
                        "content": full_response,
                    }).execute()
                    logger.info(f"Saved assistant message to session {chat_session_id}")
                except Exception as e:
                    logger.error(f"Failed to save assistant message: {e}")

    response = StreamingResponse(generate_chat_responses())
    response.headers["x-vercel-ai-data-stream"] = "v1"
    return response
