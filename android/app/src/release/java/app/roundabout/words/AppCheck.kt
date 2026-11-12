package app.roundabout.words

import android.content.Context
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory

/** Release builds prove themselves to App Check with Play Integrity. */
@Suppress("UNUSED_PARAMETER")
fun installAppCheck(context: Context) {
    FirebaseAppCheck.getInstance().installAppCheckProviderFactory(PlayIntegrityAppCheckProviderFactory.getInstance())
}

/** Release builds have no debug token. */
@Suppress("UNUSED_PARAMETER")
fun appCheckDebugToken(context: Context): String? = null
