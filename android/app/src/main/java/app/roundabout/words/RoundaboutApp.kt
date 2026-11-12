package app.roundabout.words

import android.app.Application
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions

/**
 * Starts Firebase with the settings the build was given (see app/build.gradle.kts) and turns
 * on App Check, which every Firebase AI Logic request has to pass.
 */
class RoundaboutApp : Application() {
    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.FB_API_KEY.isEmpty() || BuildConfig.FB_APP_ID.isEmpty() || BuildConfig.FB_PROJECT_ID.isEmpty()) return
        val options = FirebaseOptions.Builder()
            .setApiKey(BuildConfig.FB_API_KEY)
            .setApplicationId(BuildConfig.FB_APP_ID)
            .setProjectId(BuildConfig.FB_PROJECT_ID)
            .apply { if (BuildConfig.FB_SENDER_ID.isNotEmpty()) setGcmSenderId(BuildConfig.FB_SENDER_ID) }
            .build()
        FirebaseApp.initializeApp(this, options)
        installAppCheck(this)
        configured = true
    }

    companion object {
        /** False when the build was made without Firebase settings: the app then only explains itself. */
        @Volatile
        var configured: Boolean = false
            private set
    }
}
