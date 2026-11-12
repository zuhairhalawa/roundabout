import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.devtools.ksp")
}

// The Firebase settings of the app come from android/.env (never committed) or, in CI, from
// environment variables. Without them the app still builds and says that it is not set up.
val localEnv = Properties().apply {
    val file = rootProject.file(".env")
    if (file.exists()) file.inputStream().use { load(it) }
}

fun setting(name: String): String = (System.getenv(name) ?: localEnv.getProperty(name) ?: "").trim()

fun quoted(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

android {
    namespace = "app.roundabout.words"
    compileSdk = 37

    defaultConfig {
        applicationId = "app.roundabout.words"
        minSdk = 26 // the on-device SDK (Prompt API from ML Kit) needs API level 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        for (name in listOf("FB_API_KEY", "FB_APP_ID", "FB_PROJECT_ID", "FB_SENDER_ID")) {
            buildConfigField("String", name, quoted(setting(name)))
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    // One prompt pack for every platform: the app reads the very files the web app reads.
    sourceSets {
        getByName("main") {
            assets.srcDir("../../shared")
        }
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.core:core-ktx:1.19.1")

    // Firebase AI Logic: cloud and on-device (hybrid) inference. The on-device SDK is not in
    // the Firebase BoM yet, so the versions are given one by one.
    implementation("com.google.firebase:firebase-ai:18.1.0")
    implementation("com.google.firebase:firebase-ai-ondevice:16.0.0-beta07")
    ksp("com.google.firebase:firebase-ai-ksp-processor:17.0.0")
    implementation("com.google.firebase:firebase-appcheck:20.0.0")
    debugImplementation("com.google.firebase:firebase-appcheck-debug:20.0.0")
    releaseImplementation("com.google.firebase:firebase-appcheck-playintegrity:20.0.0")

    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.13.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
}
