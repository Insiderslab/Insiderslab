<?php
/**
 * Plugin Name:       Heili Approve – revisione «Sul sito»
 * Plugin URI:        https://approve.heili.cloud
 * Description:       Aggiunge al sito la riga di codice di Approve by Heili: il cliente apre il sito dal suo portale, tocca Heili, indica un elemento e lo commenta. Per i visitatori normali non fa nulla. Toglilo quando il sito va online.
 * Version:           1.1.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Approve by Heili
 * Author URI:        https://approve.heili.cloud
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       heili-approve-review
 *
 * Un solo file di codice, nessuna chiamata di rete dal server WordPress,
 * nessun dato dei visitatori salvato: il plugin conserva solo la chiave del
 * sito e l'indirizzo di Approve, e stampa il tag
 *   <script src="https://approve.heili.cloud/heili-review.js" data-site="hs_…" defer></script>
 * in fondo alle pagine (wp_footer). Lo script resta inerte finché la pagina non
 * viene aperta dal portale con #heili-review=… (il frammento non arriva mai al
 * server PHP, per questo il tag è sempre presente).
 *
 * Sicurezza:
 * - la pagina Impostazioni richiede la capability `manage_options`;
 * - il salvataggio passa dalla Settings API (options.php), che controlla il
 *   nonce del modulo (settings_fields) e la capability; il campo viene
 *   comunque ricontrollato in heili_approve_sanitize();
 * - ogni valore è validato (chiave `hs_…`, indirizzo https) e ripulito
 *   (sanitize_text_field, wp_unslash) prima di essere salvato;
 * - ogni valore stampato passa da esc_attr / esc_url / esc_html.
 */

if (!defined('ABSPATH')) {
	exit;
}

const HEILI_APPROVE_VERSION = '1.1.0';
const HEILI_APPROVE_OPTION = 'heili_approve_review';
const HEILI_APPROVE_DEFAULT_BASE = 'https://approve.heili.cloud';
const HEILI_APPROVE_KEY_PATTERN = '/^hs_[A-Za-z0-9_-]{16,64}$/';

/** Opzioni salvate, con i valori predefiniti. */
function heili_approve_options() {
	$saved = get_option(HEILI_APPROVE_OPTION);
	$options = wp_parse_args(is_array($saved) ? $saved : array(), array(
		'site_key' => '',
		'base_url' => HEILI_APPROVE_DEFAULT_BASE,
	));
	$options['site_key'] = is_string($options['site_key']) ? $options['site_key'] : '';
	$options['base_url'] = is_string($options['base_url']) ? $options['base_url'] : HEILI_APPROVE_DEFAULT_BASE;
	return $options;
}

/** Indirizzo di Approve: solo https (http solo per localhost), senza percorso, senza credenziali. */
function heili_approve_clean_base($value) {
	$value = trim((string) $value);
	$parts = wp_parse_url($value);
	if (!is_array($parts) || empty($parts['host']) || empty($parts['scheme'])) {
		return null;
	}
	$scheme = strtolower($parts['scheme']);
	$host = strtolower($parts['host']);
	if (!preg_match('/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/', $host)) {
		return null;
	}
	$local = ($host === 'localhost' || $host === '127.0.0.1');
	if ($scheme !== 'https' && !($scheme === 'http' && $local)) {
		return null;
	}
	if (!empty($parts['user']) || !empty($parts['pass'])) {
		return null;
	}
	$port = '';
	if (isset($parts['port'])) {
		$number = (int) $parts['port'];
		if ($number < 1 || $number > 65535) {
			return null;
		}
		$port = ':' . $number;
	}
	return $scheme . '://' . $host . $port;
}

/** La chiave del sito, se ha la forma giusta (hs_ + 16–64 caratteri), altrimenti stringa vuota. */
function heili_approve_valid_key($value) {
	$value = is_string($value) ? $value : '';
	return preg_match(HEILI_APPROVE_KEY_PATTERN, $value) ? $value : '';
}

/** Controlla quello che arriva dalla pagina Impostazioni. */
function heili_approve_sanitize($input) {
	$current = heili_approve_options();
	// Defence in depth: options.php already requires manage_options, but this callback is also reachable through update_option().
	if (!current_user_can('manage_options')) {
		return $current;
	}
	$output = $current;
	$input = is_array($input) ? $input : array();

	$key = isset($input['site_key']) ? trim(sanitize_text_field(wp_unslash($input['site_key']))) : '';
	if ($key === '' || heili_approve_valid_key($key) !== '') {
		$output['site_key'] = $key;
	} else {
		add_settings_error(HEILI_APPROVE_OPTION, 'site_key', __('La chiave non è valida: copiala di nuovo da Approve (inizia con hs_).', 'heili-approve-review'));
	}

	$base = isset($input['base_url']) ? heili_approve_clean_base(sanitize_text_field(wp_unslash($input['base_url']))) : null;
	if ($base !== null) {
		$output['base_url'] = $base;
	} else {
		add_settings_error(HEILI_APPROVE_OPTION, 'base_url', __("L'indirizzo di Approve deve iniziare con https://", 'heili-approve-review'));
	}
	return $output;
}

add_action('admin_init', function () {
	register_setting('heili_approve', HEILI_APPROVE_OPTION, array(
		'type' => 'array',
		'sanitize_callback' => 'heili_approve_sanitize',
		'default' => array('site_key' => '', 'base_url' => HEILI_APPROVE_DEFAULT_BASE),
		'show_in_rest' => false,
	));
});

add_action('admin_menu', function () {
	add_options_page(
		__('Heili Approve', 'heili-approve-review'),
		__('Heili Approve', 'heili-approve-review'),
		'manage_options',
		'heili-approve',
		'heili_approve_render_settings'
	);
});

add_filter('plugin_action_links_' . plugin_basename(__FILE__), function ($links) {
	$url = admin_url('options-general.php?page=heili-approve');
	array_unshift($links, '<a href="' . esc_url($url) . '">' . esc_html__('Impostazioni', 'heili-approve-review') . '</a>');
	return $links;
});

/** Il tag da stampare, o stringa vuota se non c'è una chiave valida. */
function heili_approve_tag($options) {
	$key = heili_approve_valid_key($options['site_key']);
	if ($key === '') {
		return '';
	}
	$base = heili_approve_clean_base($options['base_url']);
	if ($base === null) {
		return '';
	}
	// data-no-optimize / data-no-defer / data-cfasync: the optimisation plugins must not merge, delay or move it.
	return sprintf(
		'<script src="%s" data-site="%s" data-no-optimize="1" data-no-defer="1" data-cfasync="false" defer></script>',
		esc_url($base . '/heili-review.js'),
		esc_attr($key)
	);
}

/** Pagina Impostazioni → Heili Approve. */
function heili_approve_render_settings() {
	if (!current_user_can('manage_options')) {
		wp_die(esc_html__('Non hai i permessi per vedere questa pagina.', 'heili-approve-review'), '', array('response' => 403));
	}
	$options = heili_approve_options();
	$active = heili_approve_tag($options) !== '';
	?>
	<div class="wrap">
		<h1><?php esc_html_e('Heili Approve – revisione «Sul sito»', 'heili-approve-review'); ?></h1>
		<p><?php esc_html_e('Incolla la chiave del sito che trovi in Approve, nella scheda del sito, alla voce «Sul sito». Il cliente potrà commentare il sito vero aprendolo dal suo portale.', 'heili-approve-review'); ?></p>
		<p>
			<strong><?php esc_html_e('Stato:', 'heili-approve-review'); ?></strong>
			<?php if ($active) : ?>
				<?php esc_html_e('la riga di Heili è attiva su tutte le pagine del sito. Torna in Approve e premi «Verifica installazione».', 'heili-approve-review'); ?>
			<?php else : ?>
				<?php esc_html_e('spenta: manca una chiave valida. Incollala qui sotto e premi Salva.', 'heili-approve-review'); ?>
			<?php endif; ?>
		</p>
		<?php settings_errors(HEILI_APPROVE_OPTION); ?>
		<form method="post" action="options.php">
			<?php settings_fields('heili_approve'); /* nonce + option page for options.php */ ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="heili-site-key"><?php esc_html_e('Chiave del sito', 'heili-approve-review'); ?></label></th>
					<td>
						<input id="heili-site-key" class="regular-text code" type="text" name="<?php echo esc_attr(HEILI_APPROVE_OPTION); ?>[site_key]" value="<?php echo esc_attr($options['site_key']); ?>" placeholder="hs_..." autocomplete="off" spellcheck="false" maxlength="80" />
						<p class="description"><?php esc_html_e('Lasciala vuota per spegnere la revisione senza disattivare il plugin.', 'heili-approve-review'); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="heili-base-url"><?php esc_html_e('Indirizzo di Approve', 'heili-approve-review'); ?></label></th>
					<td>
						<input id="heili-base-url" class="regular-text code" type="url" name="<?php echo esc_attr(HEILI_APPROVE_OPTION); ?>[base_url]" value="<?php echo esc_attr($options['base_url']); ?>" maxlength="200" />
						<p class="description"><?php esc_html_e('Di solito non si cambia: https://approve.heili.cloud', 'heili-approve-review'); ?></p>
					</td>
				</tr>
			</table>
			<?php submit_button(__('Salva', 'heili-approve-review')); ?>
		</form>
		<p><?php esc_html_e('Per i visitatori il codice non fa nulla. Quando il sito va online, disattiva ed elimina il plugin.', 'heili-approve-review'); ?></p>
	</div>
	<?php
}

/** Il tag, in fondo a ogni pagina pubblica, solo se c'è una chiave. */
add_action('wp_footer', function () {
	if (is_admin()) {
		return;
	}
	$tag = heili_approve_tag(heili_approve_options());
	if ($tag === '') {
		return;
	}
	// The tag is built by heili_approve_tag() with esc_url / esc_attr on every value.
	echo "\n" . $tag . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
}, 100);
