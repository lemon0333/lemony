package dev.lemony

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

// lemony 백엔드 (Kotlin/Spring) — API·인증·사이트·프리뷰의 플랫폼 레이어.
// 생성/매핑 같은 LLM·코드 작업은 Node 에이전트 도구(claude CLI, Quarkify)를 ProcessBuilder 로 호출해 재사용한다.
// 프론트엔드는 React(apps/web)가 이 백엔드를 호출한다.
@SpringBootApplication
class LemonyApplication

fun main(args: Array<String>) {
    runApplication<LemonyApplication>(*args)
}
