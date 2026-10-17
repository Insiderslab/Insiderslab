<?php
/**
 * Runs when the plugin is deleted from the Plugins screen: removes the only
 * thing it stored (the site key and the address of Approve).
 */

if (!defined('WP_UNINSTALL_PLUGIN')) {
	exit;
}

delete_option('heili_approve_review');
