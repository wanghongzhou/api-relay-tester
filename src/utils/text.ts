// Generate a long text of approximately N tokens
// Rough estimate: 1 token ≈ 4 chars in English
export function generatePaddingText(targetTokens: number): string {
  const charsPerToken = 4;
  const targetChars = targetTokens * charsPerToken;
  // Use a repeating pattern that's realistic text
  const paragraph = `The World Wide Web Consortium (W3C) develops international standards for the Web including HTML, CSS, and many other technologies. These standards ensure the long-term growth of the Web. Web accessibility means that websites, tools, and technologies are designed and developed so that people with disabilities can use them. More specifically, people can perceive, understand, navigate, and interact with the Web, and they can contribute to the Web. Web accessibility encompasses all disabilities that affect access to the Web, including auditory, cognitive, neurological, physical, speech, and visual disabilities. The Web is fundamentally designed to work for all people, whatever their hardware, software, language, location, or ability. When the Web meets this goal, it is accessible to people with a diverse range of hearing, movement, sight, and cognitive ability. Thus the impact of disability is radically changed on the Web because the Web removes barriers to communication and interaction that many people face in the physical world. However, when websites, applications, technologies, or tools are badly designed, they can create barriers that exclude people from using the Web. `;

  let result = '';
  while (result.length < targetChars) {
    result += paragraph;
  }
  return result.slice(0, targetChars);
}

// Fetch a long document from the web for context length testing
export async function fetchLongDocument(minTokens: number): Promise<{ text: string; source: string }> {
  // Try to fetch W3C specs or other long documents
  const urls = [
    {
      url: 'https://www.w3.org/TR/html52/',
      source: 'W3C HTML 5.2 Specification',
    },
    {
      url: 'https://www.w3.org/TR/CSS22/',
      source: 'W3C CSS 2.2 Specification',
    },
    {
      url: 'https://www.w3.org/TR/WCAG21/',
      source: 'W3C WCAG 2.1',
    },
  ];

  for (const { url, source } of urls) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'ModelTester/1.0' },
        signal: AbortSignal.timeout(30000),
      });
      if (resp.ok) {
        let text = await resp.text();
        // Strip HTML tags roughly
        text = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const estimatedTokens = Math.floor(text.length / 4);
        if (estimatedTokens >= minTokens) {
          return { text: text.slice(0, minTokens * 5), source };
        }
      }
    } catch {
      continue;
    }
  }

  // Fallback: generate synthetic long text
  console.log('  [信息] 无法获取长文档，使用生成的填充文本');
  return {
    text: generatePaddingText(minTokens),
    source: 'Generated padding text (W3C-style)',
  };
}
