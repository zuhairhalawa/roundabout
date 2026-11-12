// Kotlin support is built into the Android Gradle plugin. The Kotlin version is set by the
// Compose compiler plugin below, which has to match it.
plugins {
    id("com.android.application") version "9.5.1" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.21" apply false
    id("org.jetbrains.kotlin.plugin.serialization") version "2.4.21" apply false
    id("com.google.devtools.ksp") version "2.3.13" apply false
}
