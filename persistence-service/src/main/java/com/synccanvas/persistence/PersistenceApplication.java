package com.synccanvas.persistence;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * 持久化服务启动类，负责启动 Spring Boot 应用。
 */
@EnableScheduling
@SpringBootApplication
public class PersistenceApplication {

    /**
     * 应用入口方法，用于启动 persistence-service。
     *
     * @param args 命令行参数
     */
    public static void main(String[] args) {
        SpringApplication.run(PersistenceApplication.class, args);
    }
}
