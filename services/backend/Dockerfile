# flowstock 컨벤션 참조: 호스트/CI 에서 ./gradlew bootJar 로 미리 빌드한 jar 를 복사.
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY build/libs/lemony-backend-*.jar app.jar
EXPOSE 8787
ENTRYPOINT ["java", "-jar", "app.jar"]
