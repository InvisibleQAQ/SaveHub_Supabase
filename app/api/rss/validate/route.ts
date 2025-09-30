import { type NextRequest, NextResponse } from "next/server"
import Parser from "rss-parser"

const parser = new Parser()

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json()

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 })
    }

    // Try to parse the RSS feed to validate it
    await parser.parseURL(url)

    return NextResponse.json({ valid: true })
  } catch (error) {
    console.error("Error validating RSS feed:", error)
    return NextResponse.json({ valid: false })
  }
}
