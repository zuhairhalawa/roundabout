package app.roundabout.words

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.viewmodel.compose.viewModel
import app.roundabout.words.ui.RoundaboutScreen
import app.roundabout.words.ui.RoundaboutTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            RoundaboutTheme {
                RoundaboutScreen(viewModel<FindViewModel>())
            }
        }
    }
}
