package dev.lemony.domain.site.controller

import com.fasterxml.jackson.databind.ObjectMapper
import dev.lemony.infra.ai.AgentService
import dev.lemony.global.response.ApiResponse
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import java.io.File

// 사이트 생성/수정/목록/프리뷰 API. 프론트(React, apps/web)가 호출.
@RestController
@CrossOrigin(origins = ["*"])
class SiteController(private val agent: AgentService, private val om: ObjectMapper) {

    data class CreateReq(val prompt: String?)
    data class EditReq(val id: String?, val prompt: String?)

    @PostMapping("/api/create")
    fun create(@RequestBody req: CreateReq): ResponseEntity<ApiResponse<*>> {
        val prompt = req.prompt ?: return ResponseEntity.badRequest().body(ApiResponse.error("BAD_REQUEST", "prompt 필요"))
        // TODO: 인증 연동 시 owner = 현재 사용자. 지금은 데모.
        val site = agent.createSite(prompt, owner = "demo")
        return ResponseEntity.ok(ApiResponse.success(mapOf("id" to site.id, "previewUrl" to "/preview/${site.id}/")))
    }

    @PostMapping("/api/edit")
    fun edit(@RequestBody req: EditReq): ResponseEntity<ApiResponse<*>> {
        val id = req.id ?: return ResponseEntity.badRequest().body(ApiResponse.error("BAD_REQUEST", "id 필요"))
        val file = File(File(agent.sitesDir(), id), "index.html")
        if (!file.exists()) return ResponseEntity.status(404).body(ApiResponse.error("NOT_FOUND", "사이트 없음"))
        file.writeText(agent.editHtml(file.readText(), req.prompt ?: ""))
        return ResponseEntity.ok(ApiResponse.success(mapOf("id" to id, "previewUrl" to "/preview/$id/")))
    }

    @GetMapping("/api/sites")
    fun sites(): ApiResponse<*> {
        val out = agent.sitesDir().listFiles { f -> f.isDirectory }?.mapNotNull { d ->
            val meta = File(d, "meta.json")
            if (!meta.exists()) return@mapNotNull null
            val m = om.readValue(meta, Map::class.java)
            mapOf("id" to d.name, "name" to m["name"], "previewUrl" to "/preview/${d.name}/")
        } ?: emptyList()
        return ApiResponse.success(mapOf("sites" to out))
    }

    // 생성된 사이트 정적 프리뷰 (단일 HTML → index.html). 경로탈출 차단.
    @GetMapping("/preview/{id}/**")
    fun preview(@PathVariable id: String): ResponseEntity<String> {
        val base = File(agent.sitesDir(), id)
        val file = File(base, "index.html")
        if (!file.canonicalPath.startsWith(base.canonicalPath) || !file.exists())
            return ResponseEntity.status(404).body("not found")
        return ResponseEntity.ok().contentType(MediaType.TEXT_HTML).body(file.readText())
    }

    // 인증: 실제 소셜로그인은 spring-boot-starter-oauth2-client(GitHub/Google) 로 추가 예정.
    @GetMapping("/api/auth/me")
    fun me(): Map<String, Any?> = mapOf("user" to null, "providers" to mapOf("github" to false, "google" to false))
}
