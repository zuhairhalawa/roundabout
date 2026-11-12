// The one screen of the app. It looks like road signage on purpose, as the web app does: signs
// are built to be understood at a glance, by anyone, with few words and a picture.
package app.roundabout.words.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.roundabout.words.FindViewModel
import app.roundabout.words.UiState
import app.roundabout.words.Way
import app.roundabout.words.core.Chip
import app.roundabout.words.core.DeviceState
import app.roundabout.words.core.Guess
import app.roundabout.words.core.Side
import app.roundabout.words.core.Source
import kotlinx.coroutines.delay
import java.util.Locale

private val Paper = Color(0xFFF6F7F5)
private val Ink = Color(0xFF16191C)
private val InkSoft = Color(0xFF4A5157)
private val Line = Color(0xFFC5CBCE)
private val Green = Color(0xFF00643C) // direction-sign green: found on this phone
private val Blue = Color(0xFF0A4A9C) // services-sign blue: from the cloud
private val Brown = Color(0xFF6F4320) // point-of-interest brown: your saved words
private val Yellow = Color(0xFFFFCD1C) // warning-sign yellow: the main action
private val Sign = RoundedCornerShape(14.dp)

@Composable
fun RoundaboutTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(primary = Ink, onPrimary = Color.White, background = Paper, surface = Color.White, onBackground = Ink, onSurface = Ink),
        content = content,
    )
}

/** What the pill at the top says about where answers come from right now. */
internal fun statusText(ui: UiState): String = when {
    !ui.configured -> "Not set up"
    !ui.deviceChecked -> "Checking this phone"
    ui.privateOnly -> "Private: this phone only"
    ui.device == DeviceState.READY -> if (ui.online) "On this phone" else "On this phone, offline"
    ui.device == DeviceState.LOADING -> if (ui.online) "Using the cloud while this phone gets ready" else "Getting this phone ready"
    ui.online -> "Using the cloud"
    else -> "Offline"
}

private fun seconds(ms: Long): String = String.format(Locale.US, "%.1f s", ms / 1000.0)

/** The line under the tiles: which side answered, how fast, and whether anything was sent. */
internal fun sourceText(ui: UiState): String = when (ui.side) {
    Side.DEVICE -> "Found on this phone in ${seconds(ui.ms)}. ${ui.cloudPart?.text ?: "Nothing was sent."}"
    Side.CLOUD -> "Found in the cloud in ${seconds(ui.ms)}."
    null -> ""
}

@Composable
fun RoundaboutScreen(vm: FindViewModel) {
    val ui = vm.ui
    val focus = LocalFocusManager.current
    var showWhy by remember { mutableStateOf(false) }
    val scroll = rememberScrollState()
    var resultsTop by remember { mutableIntStateOf(0) }

    // On a phone the answer lands below the fold. When it arrives, bring the tiles and the line
    // that says where they came from to the top of the screen.
    LaunchedEffect(ui.guesses.size, ui.busy) {
        if (ui.guesses.isNotEmpty() && !ui.busy) {
            delay(80) // let the new tiles be laid out first
            scroll.animateScrollTo(resultsTop)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Paper)
            .safeDrawingPadding()
            .verticalScroll(scroll)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Text("Roundabout", fontSize = 24.sp, fontWeight = FontWeight.ExtraBold, color = Ink, modifier = Modifier.weight(1f))
            StatusPill(ui)
        }

        Text("What is it like?", fontSize = 32.sp, fontWeight = FontWeight.ExtraBold, color = Ink)

        if (!ui.configured) {
            Note("This build was made without its Firebase settings, so it cannot ask a model. See the README for how to add them.")
        }

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
            WayButton("Describe it", ui.way == Way.DESCRIBE, Modifier.weight(1f)) { vm.setWay(Way.DESCRIBE) }
            WayButton("Tap hints", ui.way == Way.HINTS, Modifier.weight(1f)) { vm.setWay(Way.HINTS) }
        }

        Panel {
            if (ui.way == Way.DESCRIBE) {
                OutlinedTextField(
                    value = ui.clues,
                    onValueChange = vm::setClues,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 110.dp),
                    textStyle = TextStyle(fontSize = 21.sp, fontWeight = FontWeight.Medium, color = Ink),
                    placeholder = { Text("thing for the rain, over your head", fontSize = 19.sp, color = InkSoft) },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { focus.clearFocus(); vm.find() }),
                )
                Text("Any words will do. Spelling does not matter.", fontSize = 16.sp, color = InkSoft, modifier = Modifier.padding(top = 8.dp))
            } else {
                Hints(vm, ui)
            }
        }

        BigButton(if (ui.busy) "Looking…" else "Find the word", enabled = vm.canFind()) {
            focus.clearFocus()
            vm.find()
        }

        if (ui.note.isNotEmpty()) Note(ui.note)

        val token = ui.debugToken
        if (token != null) {
            Panel {
                Text("Setting up this phone", fontSize = 19.sp, fontWeight = FontWeight.Bold, color = Ink)
                Text(
                    "This is a test build. If this phone has not been registered yet, add this debug token in the Firebase console (App Check, Apps, Manage debug tokens), then try again.",
                    fontSize = 16.sp, color = InkSoft, modifier = Modifier.padding(vertical = 6.dp),
                )
                SelectionContainer { Text(token, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Ink) }
            }
        }

        if (ui.guesses.isNotEmpty()) {
            Column(
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.onGloballyPositioned { resultsTop = it.positionInParent().y.toInt() },
            ) {
                Tiles(ui.guesses, ui.chosen, vm::choose)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(sourceText(ui), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = if (ui.side == Side.DEVICE) Green else Blue, modifier = Modifier.weight(1f))
                    TextButton(onClick = { showWhy = true }) { Text("Why?", fontSize = 17.sp, color = Ink) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                    if (ui.chosen != null) SmallButton("Say it slowly", Modifier.weight(1f)) { vm.saySlowly() }
                    if (ui.canAskMore) SmallButton("None of these", Modifier.weight(1f), enabled = !ui.busy) { vm.noneOfThese() }
                }
            }
        }

        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) {
            Column(Modifier.weight(1f)) {
                Text("Private mode", fontSize = 19.sp, fontWeight = FontWeight.Bold, color = Ink)
                Text("Never use the cloud. Nothing you type leaves this phone.", fontSize = 16.sp, color = InkSoft)
            }
            Switch(checked = ui.privateOnly, onCheckedChange = vm::setPrivate)
        }

        Text(
            "Green tiles come from this phone, blue tiles from the cloud. Built with Firebase AI Logic hybrid inference.",
            fontSize = 15.sp, color = InkSoft,
        )
        Spacer(Modifier.height(8.dp))
    }

    if (showWhy) {
        AlertDialog(
            onDismissRequest = { showWhy = false },
            confirmButton = { TextButton(onClick = { showWhy = false }) { Text("OK", fontSize = 18.sp) } },
            title = { Text("Why this answer came from here") },
            text = { Text(ui.why.ifEmpty { "No model was needed." }, fontSize = 18.sp) },
        )
    }
}

@Composable
private fun StatusPill(ui: UiState) {
    val onPhone = ui.device == DeviceState.READY || ui.privateOnly
    val off = !ui.configured || (!ui.online && ui.device != DeviceState.READY)
    Surface(
        shape = RoundedCornerShape(999.dp),
        color = if (off) Yellow else Color.White,
        border = BorderStroke(2.5.dp, if (off) Ink else if (onPhone) Green else Blue),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp)) {
            Box(Modifier.size(10.dp).background(if (off) Ink else if (onPhone) Green else Blue, CircleShape))
            Spacer(Modifier.width(8.dp))
            Text(statusText(ui), fontSize = 15.sp, fontWeight = FontWeight.Bold, color = if (off) Ink else if (onPhone) Green else Blue)
        }
    }
}

@Composable
private fun Panel(content: @Composable () -> Unit) {
    Surface(shape = Sign, color = Color.White, border = BorderStroke(3.dp, Ink), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) { content() }
    }
}

@Composable
private fun Note(text: String) {
    Surface(shape = Sign, color = Color.White, border = BorderStroke(2.5.dp, Line), modifier = Modifier.fillMaxWidth()) {
        Text(text, fontSize = 18.sp, color = Ink, modifier = Modifier.padding(14.dp))
    }
}

@Composable
private fun WayButton(label: String, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = modifier.heightIn(min = 60.dp),
        shape = Sign,
        color = if (selected) Ink else Color.White,
        contentColor = if (selected) Color.White else Ink,
        border = BorderStroke(3.dp, Ink),
    ) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(8.dp)) {
            Text(label, fontSize = 19.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun BigButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = 64.dp),
        shape = Sign,
        color = if (enabled) Yellow else Color(0xFFE9E3C7),
        contentColor = if (enabled) Ink else InkSoft,
        border = BorderStroke(3.dp, if (enabled) Ink else InkSoft),
    ) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(12.dp)) {
            Text(label, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
        }
    }
}

@Composable
private fun SmallButton(label: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.heightIn(min = 56.dp),
        shape = Sign,
        color = Color.White,
        contentColor = if (enabled) Ink else InkSoft,
        border = BorderStroke(2.5.dp, if (enabled) Ink else Line),
    ) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.padding(10.dp)) {
            Text(label, fontSize = 19.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Hints(vm: FindViewModel, ui: UiState) {
    Text(vm.groupAsk, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, color = Ink)
    Spacer(Modifier.height(8.dp))
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (chip in vm.groups) {
            if (ui.group == null || ui.group == chip.id) {
                ChipButton(chip, selected = ui.group == chip.id) { vm.pickGroup(if (ui.group == chip.id) null else chip.id) }
            }
        }
    }
    for (row in vm.rows()) {
        Spacer(Modifier.height(14.dp))
        Text(row.ask, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, color = Ink)
        Spacer(Modifier.height(8.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (chip in row.chips) {
                val id = "${row.id}.${chip.id}"
                ChipButton(chip, selected = id in ui.picked) { vm.toggleChip(id) }
            }
        }
    }
}

@Composable
private fun ChipButton(chip: Chip, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = Modifier.heightIn(min = 52.dp),
        shape = RoundedCornerShape(12.dp),
        color = if (selected) Yellow else Color.White,
        contentColor = Ink,
        border = BorderStroke(2.5.dp, Ink),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
            Text(chip.emoji, fontSize = 22.sp)
            Spacer(Modifier.width(8.dp))
            Text(chip.label, fontSize = 18.sp, fontWeight = FontWeight.Bold)
        }
    }
}

/** The answers, as road signs: two to a row, a picture over the word, coloured by where they came from. */
@Composable
private fun Tiles(guesses: List<Guess>, chosen: String?, onChoose: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        for (pair in guesses.chunked(2)) {
            // Both signs in a row are as tall as the taller one.
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
                for (g in pair) Tile(g, g.word == chosen, Modifier.weight(1f).fillMaxHeight()) { onChoose(g.word) }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun Tile(g: Guess, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val color = when (g.source) {
        Source.DEVICE -> Green
        Source.CLOUD -> Blue
        Source.SAVED -> Brown
    }
    val from = when (g.source) {
        Source.DEVICE -> "from this phone"
        Source.CLOUD -> "from the cloud"
        Source.SAVED -> "one of your saved words"
    }
    Surface(
        onClick = onClick,
        modifier = modifier
            .heightIn(min = 124.dp)
            .semantics { contentDescription = "${g.word}, $from. Tap to hear it." },
        shape = Sign,
        color = color,
        contentColor = Color.White,
        border = BorderStroke(if (selected) 5.dp else 0.dp, if (selected) Yellow else color),
    ) {
        Box(Modifier.padding(6.dp).border(2.5.dp, Color.White, RoundedCornerShape(9.dp)), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 12.dp)) {
                // A word the picture table does not know is shown without a picture, not with a wrong one.
                if (g.emoji.isNotEmpty()) {
                    Text(g.emoji, fontSize = 36.sp)
                    Spacer(Modifier.height(4.dp))
                }
                Text(g.word, fontSize = if (g.emoji.isEmpty()) 26.sp else 23.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center)
            }
        }
    }
}
