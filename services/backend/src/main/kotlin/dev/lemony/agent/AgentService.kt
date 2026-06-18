package dev.lemony.agent

import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import java.io.File
import java.util.concurrent.TimeUnit

// LLM·코드 작업 오케스트레이션. 로그인된 claude CLI 를 헤드리스로 호출(키 불필요),
// Quarkify(quarkify.mjs)로 코드 토폴로지를 매핑한다. 백엔드(Kotlin)가 플랫폼·orchestration 을 소유.
@Service
class AgentService(
    @Value("\${lemony.sites-dir}") private val sitesDir: String,
    @Value("\${lemony.quarkify}") private val quarkifyPath: String,
) {
    private val sites = File(sitesDir).apply { mkdirs() }

    private val GEN_SYSTEM = """
        당신은 lemony의 웹사이트 생성 엔진입니다. 비전공자의 한국어 요청을 받아 완성된 단일 파일 웹페이지를 만듭니다.
        - 완전한 자기완결 HTML 문서 하나만 출력합니다 (인라인 style + 필요한 인라인 script). 외부 빌드/번들 없이 그대로 열려야 합니다.
        - 반응형·시맨틱·한국어 콘텐츠. 정적 브로슈어가 아니라 실제로 동작하는 인터랙션(폼 검증·제출·localStorage 저장·동적 JS)을 구현합니다.
        - 진부한 AI 느낌(보라 그라데이션, Inter/기본폰트) 금지. 주제에 맞는 고유 팔레트·타이포.
        - [중요] 어떤 도구(Write/Edit/Bash/Read)도 쓰지 말고 HTML 전문만 stdout 으로 출력. 반드시 <!DOCTYPE html> 로 시작.
    """.trimIndent()

    private fun claude(prompt: String): String {
        val p = ProcessBuilder(
            "claude", "-p", prompt,
            "--disallowedTools", "Write,Edit,Bash,Read,Glob,Grep",
            "--output-format", "text",
        ).redirectErrorStream(false).start()
        val out = p.inputStream.bufferedReader().readText()
        p.waitFor(300, TimeUnit.SECONDS)
        return out
    }

    private fun stripFence(t: String): String {
        val fence = Regex("```(?:html)?\\s*([\\s\\S]*?)```").find(t)
        return (fence?.groupValues?.get(1) ?: t).trim()
    }

    fun generateHtml(prompt: String): String {
        var html = stripFence(claude("$GEN_SYSTEM\n\n사용자 요청:\n$prompt\n\n완성된 index.html 을 출력하세요."))
        if (!Regex("(?i)<!doctype|<html").containsMatchIn(html))
            html = "<!DOCTYPE html>\n<html lang=\"ko\"><head><meta charset=\"utf-8\"></head><body>\n$html\n</body></html>"
        return html
    }

    fun editHtml(current: String, prompt: String): String {
        val full = "$GEN_SYSTEM\n\n아래 index.html 전체에 수정 요청을 반영한 전체 HTML 을 다시 출력하세요.\n\n=== 현재 ===\n$current\n\n=== 수정 요청 ===\n$prompt"
        val html = stripFence(claude(full))
        return if (Regex("(?i)<!doctype|<html").containsMatchIn(html)) html else current
    }

    data class Site(val id: String, val dir: File, val file: File)

    fun createSite(prompt: String, owner: String): Site {
        val id = "site_" + System.currentTimeMillis().toString(36)
        val dir = File(sites, id).apply { mkdirs() }
        val file = File(dir, "index.html")
        file.writeText(generateHtml(prompt))
        File(dir, "meta.json").writeText(
            """{"owner":${jsonStr(owner)},"name":${jsonStr(prompt.take(40))},"updatedAt":${System.currentTimeMillis()}}"""
        )
        return Site(id, dir, file)
    }

    // Quarkify 로 생성 코드 매핑 (섹션 단위 그라운딩 편집의 토대 — HTML/TS/Kotlin 파서 활용)
    fun quarkify(dir: File) {
        val cfg = File(dir, ".lemony.quarkify.mjs")
        cfg.writeText(
            "export default { name:'lemony', srcDir:${jsonStr(dir.absolutePath)}, " +
                "outDir:${jsonStr(File(dir, ".map").absolutePath)}, sourceFiles:['auto'], perfData:{}, incremental:true, guessRole:()=>'ui' };"
        )
        ProcessBuilder("node", quarkifyPath, cfg.absolutePath).start().waitFor(120, TimeUnit.SECONDS)
    }

    fun sitesDir() = sites
    private fun jsonStr(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ") + "\""
}
