<?php
/**
 * Plugin Name:       Heili Approve – revisione «Sul sito»
 * Description:       Aggiunge al sito la riga di codice di Approve by Heili: il cliente apre il sito dal suo portale, tocca Heili, indica un elemento e lo commenta. Per i visitatori normali non fa nulla. Toglilo quando il sito va online.
 * Version:           1.0.0
 * Requires at least: 5.8
 * Requires PHP:      7.4
 * Author:            Approve by Heili
 * License:           GPL-2.0-or-later
 * Text Domain:       heili-approve-review
 *
 * Un solo file, nessuna chiamata di rete dal server WordPress, nessun dato dei
 * visitatori salvato: il plugin conserva solo la chiave del sito e l'indirizzo
 * di Approve, e stampa il tag
 *   <script src="https://approve.heili.cloud/heili-review.js" data-site="hs_…" defer></script>
 * in fondo alle pagine (wp_footer). Lo script resta inerte finché la pagina non
 * viene aperta dal portale con #heili-review=… (il frammento non arriva mai al
 * server PHP, per questo il tag è sempre presente).
 */

if (!defined('ABSPATH')) {
	exit;
}

const HEILI_APPROVE_OPTION = 'heili_approve_review';
const HEILI_APPROVE_DEFAULT_BASE = 'https://approve.heili.cloud';

/** Opzioni salvate, con i valori predefiniti. */
function heili_approve_options() {
	$saved = get_option(HEILI_APPROVE_OPTION);
	return wp_parse_args(is_array($saved) ? $saved : array(), array(
		'site_key' => '',
		'base_url' => HEILI_APPROVE_DEFAULT_BASE,
	));
}

/** Indirizzo di Approve: solo https (http solo per localhost), senza percorso. */
function heili_approve_clean_base($value) {
	$value = trim((string) $value);
	$parts = wp_parse_url($value);
	if (!is_array($parts) || empty($parts['host']) || empty($parts['scheme'])) {
		return null;
	}
	$scheme = strtolower($parts['scheme']);
	$host = strtolower($parts['host']);
	$local = ($host === 'localhost' || $host === '127.0.0.1');
	if ($scheme !== 'https' && !($scheme === 'http' && $local)) {
		return null;
	}
	if (!empty($parts['user']) || !empty($parts['pass'])) {
		return null;
	}
	$port = isset($parts['port']) ? ':' . (int) $parts['port'] : '';
	return $scheme . '://' . $host . $port;
}

/** Controlla quello che arriva dalla pagina Impostazioni. */
function heili_approve_sanitize($input) {
	$current = heili_approve_options();
	$output = $current;
	$input = is_array($input) ? $input : array();

	$key = isset($input['site_key']) ? trim(sanitize_text_field(wp_unslash($input['site_key']))) : '';
	if ($key === '' || preg_match('/^hs_[A-Za-z0-9_-]{16,64}$/', $key)) {
		$output['site_key'] = $key;
	} else {
		add_settings_error(HEILI_APPROVE_OPTION, 'site_key', __('La chiave non è valida: copiala di nuovo da Approve (inizia con hs_).', 'heili-approve-review'));
	}

	$base = isset($input['base_url']) ? heili_approve_clean_base(wp_unslash($input['base_url'])) : null;
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

/** Pagina Impostazioni → Heili Approve. */
function heili_approve_render_settings() {
	if (!current_user_can('manage_options')) {
		return;
	}
	$options = heili_approve_options();
	?>
	<div class="wrap">
		<h1><?php esc_html_e('Heili Approve – revisione «Sul sito»', 'heili-approve-review'); ?></h1>
		<p><?php esc_html_e('Incolla la chiave del sito che trovi in Approve, nella scheda del sito, alla voce «Sul sito». Il cliente potrà commentare il sito vero aprendolo dal suo portale.', 'heili-approve-review'); ?></p>
		<?php settings_errors(HEILI_APPROVE_OPTION); ?>
		<form method="post" action="options.php">
			<?php settings_fields('heili_approve'); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="heili-site-key"><?php esc_html_e('Chiave del sito', 'heili-approve-review'); ?></label></th>
					<td>
						<input id="heili-site-key" class="regular-text code" type="text" name="<?php echo esc_attr(HEILI_APPROVE_OPTION); ?>[site_key]" value="<?php echo esc_attr($options['site_key']); ?>" placeholder="hs_..." autocomplete="off" />
						<p class="description"><?php esc_html_e('Lasciala vuota per spegnere la revisione senza disattivare il plugin.', 'heili-approve-review'); ?></p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="heili-base-url"><?php esc_html_e('Indirizzo di Approve', 'heili-approve-review'); ?></label></th>
					<td>
						<input id="heili-base-url" class="regular-text code" type="url" name="<?php echo esc_attr(HEILI_APPROVE_OPTION); ?>[base_url]" value="<?php echo esc_attr($options['base_url']); ?>" />
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
	$options = heili_approve_options();
	if ($options['site_key'] === '' || !preg_match('/^hs_[A-Za-z0-9_-]{16,64}$/', $options['site_key'])) {
		return;
	}
	$base = heili_approve_clean_base($options['base_url']);
	if ($base === null) {
		return;
	}
	// data-no-optimize / data-cfasync: the optimisation plugins must not merge or delay it.
	printf(
		"\n<script src=\"%s\" data-site=\"%s\" data-no-optimize=\"1\" data-cfasync=\"false\" defer></script>\n",
		esc_url($base . '/heili-review.js'),
		esc_attr($options['site_key'])
	);
}, 100);

register_uninstall_hook(__FILE__, 'heili_approve_uninstall');

function heili_approve_uninstall() {
	delete_option(HEILI_APPROVE_OPTION);
}
