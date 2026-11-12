package app.roundabout.words

import android.content.Context
import android.content.SharedPreferences
import com.google.firebase.FirebaseApp
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory
import java.io.File

private const val SECRET = "com.google.firebase.appcheck.debug.DEBUG_SECRET"

/** Where the App Check debug provider keeps its token. */
private fun store(context: Context): SharedPreferences? {
    val key = runCatching { FirebaseApp.getInstance().persistenceKey }.getOrNull() ?: return null
    return context.getSharedPreferences("com.google.firebase.appcheck.debug.store.$key", Context.MODE_PRIVATE)
}

/**
 * Debug builds prove themselves to App Check with a debug token. The token is made on the
 * phone the first time the app runs and has to be registered in the Firebase console
 * (App Check, Apps, Manage debug tokens). It is never part of the source or of a build.
 */
fun installAppCheck(context: Context) {
    // An automated run (the emulator in GitHub Actions) hands the app a token that is already
    // registered, as a file in the app's own folder. It is used in place of a new one.
    val handed = File(context.filesDir, "appcheck-debug-token")
    if (handed.exists()) {
        val token = handed.readText().trim()
        if (token.isNotEmpty()) store(context)?.edit()?.putString(SECRET, token)?.commit()
        handed.delete()
    }
    val appCheck = FirebaseAppCheck.getInstance()
    appCheck.installAppCheckProviderFactory(DebugAppCheckProviderFactory.getInstance())
    appCheck.getAppCheckToken(false) // makes the debug token on first run, so it can be shown and registered
}

/**
 * This phone's debug token, once it has been made. The app shows it when a request is refused,
 * so that it can be registered without a cable or a log reader.
 */
fun appCheckDebugToken(context: Context): String? = store(context)?.getString(SECRET, null)
